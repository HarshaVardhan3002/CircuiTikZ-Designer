// src/scripts/vision/controllers/visionImportController.ts
import { Modal } from "bootstrap"
import {
	DiagnosticsCollector,
	ImportController,
	MainController,
	applyImportResult,
	type ImportResult,
} from "../../internal"
import { getProvider } from "../visionProvider"
import {
	getActiveProviderId,
	loadProviderConfig,
} from "../storage/providerStorage"
import { preprocessImage } from "../pipeline/imagePreprocessor"
import { mapDetectionResult, type SymbolTypeResolver } from "../pipeline/detectionResultMapper"
import { CIRCUITIKZ_ALIASES } from "../../import/tikzTransformer"
import { buildBrowserVocabulary } from "../prompts/componentVocabulary"
import { VisionError } from "../visionError"
import { ReviewChipController } from "./reviewChipController"
import { logBus } from "../../logBus"

/**
 * Looks up a tikzName against the live symbol library on MainController to decide whether the
 * detected component should be wrapped as a node-symbol or a path-symbol save object. Returns
 * null when the tikzName isn't registered (mapper falls back to "node" + diagnostic).
 */
/**
 * Vision internalTypes that need an explicit tikzName the alias/substring passes can't reach
 * (mostly nodes: transistors, MOSFETs, signal grounds).
 */
const VISION_TO_TIKZ: Record<string, string> = {
	vsource: "american voltage source",
	isource: "american current source",
	"bjt-npn": "npn",
	"bjt-pnp": "pnp",
	nmos: "nmos",
	pmos: "pmos",
	sground: "ground",
	"ground-signal": "ground",
	potentiometer: "american potentiometer",
	"polar-capacitor": "capacitor",
}

/**
 * Resolve a vision internalType (friendly name like "resistor" / "led" / "bjt-npn") to the REAL
 * CircuiTikZ symbol in the live library, returning its canonical tikzName + kind. Tries: exact match,
 * the explicit vision→tikz map, the CircuiTikZ alias table, then a token-substring match ("resistor"
 * → "american resistor", "led" → "empty led"). Returns null if nothing matches (mapper places a
 * placeholder + diagnostic). This is what stops every detected part from failing to hydrate.
 */
const resolveSymbol: SymbolTypeResolver = (internal) => {
	const symbols = (MainController.instance as unknown as { symbols?: { tikzName: string; isNodeSymbol: boolean }[] }).symbols
	if (!symbols || !internal) return null
	const lc = internal.toLowerCase()
	const byName = (name: string) => symbols.find((s) => s.tikzName?.toLowerCase() === name.toLowerCase())
	let sym = byName(lc)
	if (!sym && VISION_TO_TIKZ[lc]) sym = byName(VISION_TO_TIKZ[lc])
	if (!sym && CIRCUITIKZ_ALIASES[lc]) {
		for (const cand of CIRCUITIKZ_ALIASES[lc]) {
			sym = byName(cand)
			if (sym) break
		}
	}
	if (!sym) {
		for (const tok of lc.split(/[^a-z]+/).filter((t) => t.length >= 3)) {
			sym = symbols.find((s) => s.tikzName?.toLowerCase().includes(tok))
			if (sym) break
		}
	}
	if (!sym) return null
	return { tikzName: sym.tikzName, kind: sym.isNodeSymbol ? "node" : "path" }
}

/**
 * Owner of the Image tab in the import modal, the in-flight progress modal, and the page-level
 * drag-drop overlay. Drives the detection pipeline end-to-end:
 *
 *   pickFile → preprocess → provider.detect → mapDetectionResult → applyImportResult
 */
export class VisionImportController {
	private static _instance: VisionImportController
	public static get instance(): VisionImportController {
		return (this._instance ??= new VisionImportController())
	}

	private dropArea!: HTMLDivElement
	private fileInput!: HTMLInputElement
	private pendingLabel!: HTMLDivElement
	private providerInfo!: HTMLSpanElement
	private configureLink!: HTMLAnchorElement
	private detectBtn!: HTMLButtonElement

	private inFlightModal!: Modal
	private inFlightModalEl!: HTMLDivElement
	private inFlightStatus!: HTMLDivElement
	private inFlightElapsed!: HTMLDivElement
	private inFlightCancel!: HTMLButtonElement

	private dropOverlay: HTMLDivElement | null = null

	private pendingFile: File | null = null
	private currentAbort: AbortController | null = null
	private elapsedTimer: number | null = null

	private bound = false

	private constructor() {}

	public bind(): void {
		if (this.bound) return
		const dropArea = document.getElementById("visionDropArea") as HTMLDivElement | null
		if (!dropArea) return // markup absent - silently no-op

		this.dropArea = dropArea
		this.fileInput = document.getElementById("visionFileInput") as HTMLInputElement
		this.pendingLabel = document.getElementById("visionPendingFile") as HTMLDivElement
		this.providerInfo = document.getElementById("visionProviderInfo") as HTMLSpanElement
		this.configureLink = document.getElementById("visionConfigureLink") as HTMLAnchorElement
		this.detectBtn = document.getElementById("visionDetectButton") as HTMLButtonElement

		this.inFlightModalEl = document.getElementById("visionInFlightModal") as HTMLDivElement
		this.inFlightModal = new Modal(this.inFlightModalEl)
		this.inFlightStatus = document.getElementById("visionInFlightStatus") as HTMLDivElement
		this.inFlightElapsed = document.getElementById("visionInFlightElapsed") as HTMLDivElement
		this.inFlightCancel = document.getElementById("visionInFlightCancel") as HTMLButtonElement

		this.dropOverlay = document.getElementById("visionCanvasDropOverlay") as HTMLDivElement | null

		this.fileInput.addEventListener("change", () => this.setPending(this.fileInput.files?.[0] ?? null))
		this.dropArea.addEventListener("dragenter", (e) => {
			e.preventDefault()
		})
		this.dropArea.addEventListener("dragover", (e) => {
			e.preventDefault()
		})
		this.dropArea.addEventListener("drop", (e) => {
			e.preventDefault()
			const f = e.dataTransfer?.files?.[0]
			if (f) this.setPending(f)
		})

		this.detectBtn.addEventListener("click", () => {
			void this.startDetect()
		})
		this.configureLink.addEventListener("click", (e) => {
			e.preventDefault()
			this.openSettingsModal()
		})
		this.inFlightCancel.addEventListener("click", () => this.cancel())

		// Refresh provider info each time the import modal is shown - the user may have just edited
		// it in the settings modal.
		const importModalEl = document.getElementById("loadModal")
		importModalEl?.addEventListener("shown.bs.modal", () => this.refreshProviderInfo())

		this.bindCanvasDragDrop()
		void this.refreshProviderInfo()

		this.bound = true
	}

	public async refreshProviderInfo(): Promise<void> {
		if (!this.providerInfo) return
		const id = getActiveProviderId()
		if (!id) {
			this.providerInfo.textContent = "none configured"
			this.detectBtn.disabled = true
			return
		}
		const cfg = await loadProviderConfig(id)
		if (!cfg) {
			this.providerInfo.textContent = "configured but not loadable"
			this.detectBtn.disabled = true
			return
		}
		this.providerInfo.textContent = `${cfg.providerId} · ${cfg.model || "(no model)"}`
		this.detectBtn.disabled = !this.pendingFile
	}

	private setPending(f: File | null): void {
		this.pendingFile = f
		if (!f) {
			this.pendingLabel.textContent = ""
			this.detectBtn.disabled = true
			return
		}
		this.pendingLabel.textContent = `Selected: ${f.name} (${(f.size / 1024).toFixed(0)} KB, ${f.type})`
		this.detectBtn.disabled = !getActiveProviderId()
	}

	/** Public entry point for both the Detect button and the canvas drop. */
	public async detectFromFile(file: File): Promise<void> {
		// Make sure the modal is open so the user has a clear UI surface - we set the file first so
		// they don't see the disabled Detect button briefly.
		this.setPending(file)
		// If the import modal isn't already showing the Image tab, surface it for context.
		try {
			ImportController.instance.open("upload")
			// ImportController only knows about "upload" / "paste" - switch to the Image tab manually.
			const imageTabBtn = document.getElementById("importTabImage") as HTMLButtonElement | null
			imageTabBtn?.click()
		} catch {
			// open() may throw if the modal isn't initialised yet - fall through.
		}
		await this.startDetect()
	}

	private async startDetect(): Promise<void> {
		if (!this.pendingFile) return
		const id = getActiveProviderId()
		const cfg = id ? await loadProviderConfig(id) : null
		const provider = id ? getProvider(id) : null
		if (!id || !cfg || !provider) {
			alert("Configure a provider first (Settings → AI Provider).")
			return
		}

		this.openInFlight()
		const ac = new AbortController()
		this.currentAbort = ac

		logBus.info("tool", `vision: detect start (${cfg.providerId} · ${cfg.model || "?"})`, {
			file: this.pendingFile.name,
			bytes: this.pendingFile.size,
		})
		try {
			const pre = await preprocessImage(this.pendingFile)
			this.inFlightStatus.textContent = `Analysing image with ${cfg.model}…`
			const detection = await provider.detect(
				{
					imageBlob: pre.blob,
					imageMimeType: pre.mimeType,
					imageWidth: pre.width,
					imageHeight: pre.height,
					vocabulary: buildBrowserVocabulary(),
				},
				cfg,
				ac.signal,
			)
			const result: ImportResult = mapDetectionResult(
				detection,
				buildBrowserVocabulary(),
				new DiagnosticsCollector(""),
				resolveSymbol,
			)
			logBus.info("tool", "vision: detect ok", {
				components: detection.components.length,
				wires: detection.wires.length,
				warnings: detection.warnings.length,
			})
			applyImportResult(result, {
				removeExisting: false,
				selectImported: true,
				collector: new DiagnosticsCollector(""),
			})
			ReviewChipController.instance.update()
			ImportController.instance.close()
		} catch (e) {
			this.handleError(e)
		} finally {
			this.closeInFlight()
			this.currentAbort = null
		}
	}

	private cancel(): void {
		this.currentAbort?.abort()
	}

	private openInFlight(): void {
		this.inFlightStatus.textContent = "Preparing image…"
		this.inFlightElapsed.textContent = "0 s elapsed"
		const start = Date.now()
		this.elapsedTimer = window.setInterval(() => {
			const s = Math.floor((Date.now() - start) / 1000)
			this.inFlightElapsed.textContent = `${s} s elapsed`
		}, 250)
		this.inFlightModal.show()
	}

	private closeInFlight(): void {
		if (this.elapsedTimer) {
			clearInterval(this.elapsedTimer)
			this.elapsedTimer = null
		}
		this.inFlightModal.hide()
	}

	private handleError(e: unknown): void {
		if (e instanceof VisionError && e.kind === "cancelled") {
			// Silent on cancel.
			logBus.info("tool", "vision: detect cancelled")
			return
		}
		// Propagate AbortError too - fetch will throw a DOMException with name "AbortError".
		if (e instanceof DOMException && e.name === "AbortError") {
			logBus.info("tool", "vision: detect aborted")
			return
		}
		const msg = e instanceof Error ? e.message : String(e)
		// A failure AFTER a 200 response (schema/JSON parse) is not caught by the fetch patch, so log it
		// here or it would be invisible in the log panel / get_logs.
		const kind = e instanceof VisionError ? e.kind : "unknown"
		logBus.error("tool", `vision: detect failed (${kind}): ${msg}`)
		alert(`Detection failed: ${msg}`)
	}

	/**
	 * Open the settings modal. We close the import modal first so the user sees only one modal at a
	 * time; we trigger the settings modal via the existing Bootstrap toggle button on the top bar.
	 */
	private openSettingsModal(): void {
		ImportController.instance.close()
		// Try the canonical "settings" id first, then fall back to the tab-management modal which is
		// the actual settings UI in this codebase.
		let trigger = document.querySelector('[data-bs-target="#settingsModal"]') as HTMLElement | null
		if (!trigger) {
			trigger = document.querySelector('[data-bs-target="#tabManagementModal"]') as HTMLElement | null
		}
		// Defer one tick so the import modal's hide animation doesn't race the settings open.
		setTimeout(() => trigger?.click(), 200)
	}

	// --- drag-drop image onto the canvas ---------------------------------------------------

	private bindCanvasDragDrop(): void {
		if (!this.dropOverlay) return
		const overlay = this.dropOverlay
		const showOverlay = () => overlay.classList.add("is-active")
		const hideOverlay = () => overlay.classList.remove("is-active")

		const dropTarget = document.body // canvas events are flaky; body works
		dropTarget.addEventListener("dragenter", (e) => {
			if (this.isImageDrag(e)) showOverlay()
		})
		dropTarget.addEventListener("dragover", (e) => {
			if (this.isImageDrag(e)) {
				e.preventDefault()
				showOverlay()
			}
		})
		dropTarget.addEventListener("dragleave", (e) => {
			if (e.relatedTarget === null) hideOverlay()
		})
		dropTarget.addEventListener("drop", (e) => {
			hideOverlay()
			if (!this.isImageDrag(e)) return
			e.preventDefault()
			const f = e.dataTransfer?.files?.[0]
			if (f) void this.detectFromFile(f)
		})
	}

	private isImageDrag(e: DragEvent): boolean {
		const types = e.dataTransfer?.types
		if (!types) return false
		if (Array.from(types).includes("Files")) {
			const items = e.dataTransfer?.items
			if (!items) return true // best effort
			return Array.from(items).some((i) => i.kind === "file" && i.type.startsWith("image/"))
		}
		return false
	}
}
