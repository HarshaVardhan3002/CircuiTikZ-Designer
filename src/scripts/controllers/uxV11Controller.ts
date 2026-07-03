/**
 * UX additions for V1.1 — wiring for the navbar dropdowns, the empty-canvas hint,
 * the welcome toast, the AI-provider chips (navbar + status bar), and the `?`
 * shortcut overlay.
 *
 * Designed to be strictly additive on top of the existing controllers. We never
 * mutate state owned by MainController, ImportController, ExportController, etc.
 * — we only dispatch click events on the legacy IDs (which remain in the DOM
 * via the `data-ux-v11-legacy="hidden"` `<li>`s) so existing handlers fire.
 *
 * Bind once on DOMContentLoaded from index.ts.
 */

import { Modal, Tab, Tooltip } from "bootstrap"
import {
	getActiveProviderId,
	loadProviderConfig,
} from "../vision/storage/providerStorage"
import type { ProviderId } from "../vision/visionProvider"
import { applyTranslations, t } from "../i18n"
import { MainController } from "./mainController"

/** Authoritative version string. Keep in sync with package.json version. */
export const APP_VERSION = "v1.1.0"

const ONBOARDED_KEY = "ctd-onboarded"
const ONBOARDING_AUTOHIDE_MS = 30_000

/**
 * Top-level binder for the V1.1 UX layer. Idempotent — safe to call more than
 * once; each sub-binder guards against double-binding.
 */
export class UxV11Controller {
	private static _instance: UxV11Controller
	public static get instance(): UxV11Controller {
		return (this._instance ??= new UxV11Controller())
	}

	private bound = false

	private constructor() {}

	public bindAll(): void {
		if (this.bound) return
		this.bound = true

		this.bindVersionLabel()
		this.bindNavbarDropdowns()
		this.bindNavUndoRedo()
		this.bindShortcutOverlay()
		this.bindEmptyCanvasHint()
		this.bindAiProviderChips()
		this.bindOnboardingHint()
		this.bindStorageSync()
		this.refreshTooltipsForNewElements()
	}

	// ----------------------------------------------------------------------
	// Version label
	// ----------------------------------------------------------------------
	/** Stamp the current version into the navbar pill. */
	private bindVersionLabel(): void {
		const badge = document.getElementById("appVersionBadge")
		if (badge) {
			badge.textContent = APP_VERSION
			badge.classList.remove("d-none")
			badge.classList.add("d-md-inline-flex")
		}
		// Also update the legacy "version" placeholders (".version" pills in the
		// brand area / about modal) so they don't show the historical "v0.0.0".
		document.querySelectorAll<HTMLElement>(".navbar-brand .version, .modal-header .version, .offcanvas-title .version").forEach((el) => {
			el.textContent = ` ${APP_VERSION} `
		})
	}

	// ----------------------------------------------------------------------
	// Navbar dropdowns: Import / Export / Save
	// ----------------------------------------------------------------------
	/** Dispatch a synthetic click on the named legacy button. */
	private clickLegacy(id: string): void {
		const el = document.getElementById(id) as HTMLButtonElement | null
		if (el) el.click()
	}

	/**
	 * Wire the new Import dropdown (file / paste / detect-from-image) and
	 * Export dropdown (TikZ / SVG) to the legacy hidden buttons. The Image item
	 * goes one extra step: open the import modal, then switch to the Image tab.
	 */
	private bindNavbarDropdowns(): void {
		// Import dropdown
		const importFile = document.getElementById("uxImportFileItem")
		if (importFile) {
			importFile.addEventListener("click", (ev) => {
				ev.preventDefault()
				this.clickLegacy("loadButton")
			})
		}
		const importPaste = document.getElementById("uxImportPasteItem")
		if (importPaste) {
			importPaste.addEventListener("click", (ev) => {
				ev.preventDefault()
				this.clickLegacy("importTikZButton")
			})
		}
		const importImage = document.getElementById("uxImportImageItem")
		if (importImage) {
			importImage.addEventListener("click", (ev) => {
				ev.preventDefault()
				this.openImportImageTab()
			})
		}

		// Export dropdown
		const exportTikz = document.getElementById("uxExportTikzItem")
		if (exportTikz) {
			exportTikz.addEventListener("click", (ev) => {
				ev.preventDefault()
				this.clickLegacy("exportCircuiTikZButton")
			})
		}
		const exportSvg = document.getElementById("uxExportSvgItem")
		if (exportSvg) {
			exportSvg.addEventListener("click", (ev) => {
				ev.preventDefault()
				this.clickLegacy("exportSVGButton")
			})
		}
	}

	/**
	 * Open the import modal pre-switched to the Image tab. Mirrors the logic in
	 * MainController for the toolbar's #modeDetectImage button so users land in
	 * the same place from either entry point.
	 */
	private openImportImageTab(): void {
		// Show the import modal first via Bootstrap. We don't have access to the
		// ImportController instance here without coupling — but its modal element
		// is identified by #loadModal, which is enough.
		const modalEl = document.getElementById("loadModal")
		if (!modalEl) return
		Modal.getOrCreateInstance(modalEl).show()
		// Defer the tab switch one tick so Bootstrap finishes opening.
		const showImageTab = () => {
			const imageTabBtn = document.getElementById("importTabImage") as HTMLButtonElement | null
			if (imageTabBtn) Tab.getOrCreateInstance(imageTabBtn).show()
		}
		// Bootstrap fires shown.bs.modal once the transition completes.
		modalEl.addEventListener("shown.bs.modal", showImageTab, { once: true })
		// Belt-and-braces in case the transition is disabled or the modal was
		// already open (no event will fire).
		setTimeout(showImageTab, 200)
	}

	// ----------------------------------------------------------------------
	// Navbar Undo / Redo (mirrors of the floating-toolbar #undoButton / #redoButton)
	// ----------------------------------------------------------------------
	private bindNavUndoRedo(): void {
		const navUndo = document.getElementById("navUndoButton")
		if (navUndo) {
			navUndo.addEventListener("click", (ev) => {
				ev.preventDefault()
				this.clickLegacy("undoButton")
			})
		}
		const navRedo = document.getElementById("navRedoButton")
		if (navRedo) {
			navRedo.addEventListener("click", (ev) => {
				ev.preventDefault()
				this.clickLegacy("redoButton")
			})
		}
	}

	// ----------------------------------------------------------------------
	// Shortcut overlay (`?` opens the existing helpModal)
	// ----------------------------------------------------------------------
	/**
	 * Bind `?` to open the existing helpModal. We use a raw keydown listener
	 * (not hotkeys-js) so we can rely on `event.key === "?"` instead of having
	 * to spell out the Shift+/ combination across keyboard layouts. We bail out
	 * if the event originates inside an editable element.
	 */
	private bindShortcutOverlay(): void {
		const helpEl = document.getElementById("helpModal")
		if (!helpEl) return

		const isEditable = (el: EventTarget | null): boolean => {
			if (!(el instanceof HTMLElement)) return false
			if (el.isContentEditable) return true
			const tag = el.tagName
			return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
		}

		document.addEventListener("keydown", (ev) => {
			if (ev.key !== "?") return
			if (ev.ctrlKey || ev.metaKey || ev.altKey) return
			if (isEditable(ev.target)) return
			ev.preventDefault()
			Modal.getOrCreateInstance(helpEl).show()
		})
	}

	// ----------------------------------------------------------------------
	// Empty-canvas hint (`?` row + i18n refresh)
	// ----------------------------------------------------------------------
	/**
	 * Populate the third "way to start" row with a `?` keyboard chip. The other
	 * two rows are static (driven by data-i18n), and #hintRow1 / #hintRow2 are
	 * still owned by mainController.renderEmptyCanvasHint.
	 */
	private bindEmptyCanvasHint(): void {
		const refresh = () => {
			const helpRow = document.getElementById("hintRowHelp")
			if (helpRow) {
				helpRow.innerHTML = t("hint.way.help", { qmark: `<kbd>?</kbd>` })
			}
		}
		refresh()
		window.addEventListener("locale-changed", refresh)
	}

	// ----------------------------------------------------------------------
	// AI provider chips (navbar + status bar)
	// ----------------------------------------------------------------------
	/**
	 * Read the active vision provider from localStorage and reflect it into:
	 *   • #navAiProviderChip          (navbar pill — model name)
	 *   • #statusAiProvider           (status-bar chip — provider · model)
	 * Hidden when no provider is configured.
	 */
	private bindAiProviderChips(): void {
		const refresh = () => this.refreshAiProviderChips()
		refresh()
		// Re-read whenever the vision settings UI saves (it dispatches no event,
		// so we listen for storage changes from other tabs and re-poll on focus).
		window.addEventListener("storage", (ev) => {
			if (!ev.key) return
			if (ev.key.startsWith("circuitvision.")) refresh()
		})
		window.addEventListener("focus", refresh)
	}

	private refreshAiProviderChips(): void {
		const navChip = document.getElementById("navAiProviderChip")
		const navChipLabel = document.getElementById("navAiProviderChipLabel")
		const statusChip = document.getElementById("statusAiProvider")
		const statusChipLabel = document.getElementById("statusAiProviderLabel")
		const statusDivider = document.querySelector(".status-ai-divider") as HTMLElement | null

		const providerId = getActiveProviderId()
		if (!providerId) {
			if (navChip) navChip.classList.add("d-none")
			if (statusChip) statusChip.classList.add("d-none")
			if (statusDivider) statusDivider.classList.add("d-none")
			return
		}
		const cfg = loadProviderConfig(providerId)
		const providerName = this.providerDisplayName(providerId)
		const model = cfg?.model || "—"
		// Status-bar chip: full "provider · model" — readable but small.
		if (statusChip && statusChipLabel) {
			statusChipLabel.textContent = `${providerName} · ${model}`
			statusChip.classList.remove("d-none")
			if (statusDivider) statusDivider.classList.remove("d-none")
		}
		// Navbar pill: short — just the model name. Tooltip shows the full thing.
		if (navChip && navChipLabel) {
			navChipLabel.textContent = model
			navChip.classList.remove("d-none")
			navChip.classList.add("d-inline-flex")
			navChip.setAttribute("data-bs-title", `AI: ${providerName} · ${model}`)
			navChip.setAttribute("title", `AI: ${providerName} · ${model}`)
			// Update the existing tooltip instance so it picks up the new title.
			const tip = Tooltip.getInstance(navChip)
			if (tip) tip.setContent({ ".tooltip-inner": `AI: ${providerName} · ${model}` })
		}
	}

	private providerDisplayName(id: ProviderId): string {
		switch (id) {
			case "openai-compat":
				return "OpenAI-compat"
			case "anthropic":
				return "Claude"
			case "gemini":
				return "Gemini"
			default:
				return String(id)
		}
	}

	// ----------------------------------------------------------------------
	// Onboarding hint (first-visit dismissible toast)
	// ----------------------------------------------------------------------
	/**
	 * Show a one-time welcome toast when localStorage doesn't yet have the
	 * `ctd-onboarded` flag. Dismiss button or 30 s auto-hide both mark it done.
	 */
	private bindOnboardingHint(): void {
		// Check whether we should show the welcome.
		try {
			if (localStorage.getItem(ONBOARDED_KEY) === "true") return
		} catch {
			// localStorage unavailable (private mode, etc.) — silently skip.
			return
		}

		// Defer one tick so we don't compete with other startup work (vision
		// review chip, etc.).
		setTimeout(() => this.showOnboardingToast(), 250)
	}

	private showOnboardingToast(): void {
		// Don't double-render if a previous call already mounted one.
		if (document.getElementById("uxV11WelcomeToast")) return

		const host = this.ensureOnboardingHost()
		const card = document.createElement("div")
		card.id = "uxV11WelcomeToast"
		card.setAttribute("role", "status")
		card.setAttribute("aria-live", "polite")
		card.className = "ux-v11-welcome-card"
		// Inline layout (typography lives in polish.scss UX additions block).
		card.innerHTML = `
			<div class="ux-v11-welcome-head">
				<span class="material-symbols-outlined ux-v11-welcome-icon" aria-hidden="true">auto_awesome</span>
				<strong>${t("welcome.title")}</strong>
				<button type="button" class="btn-close btn-close-white ms-auto" id="uxV11WelcomeDismiss" aria-label="Dismiss"></button>
			</div>
			<div class="ux-v11-welcome-body">${t("welcome.body")}</div>
			<div class="ux-v11-welcome-actions">
				<button type="button" class="btn btn-sm btn-primary" id="uxV11WelcomeOpenImport">${t("welcome.action.detect")}</button>
				<button type="button" class="btn btn-sm btn-outline-secondary" id="uxV11WelcomeOpenHelp">${t("welcome.action.shortcuts")}</button>
			</div>
		`
		host.appendChild(card)

		const markOnboarded = () => {
			try {
				localStorage.setItem(ONBOARDED_KEY, "true")
			} catch {
				// silent
			}
		}
		const dismiss = () => {
			markOnboarded()
			card.classList.add("ux-v11-welcome-leaving")
			setTimeout(() => card.remove(), 220)
		}
		document.getElementById("uxV11WelcomeDismiss")?.addEventListener("click", dismiss)
		document.getElementById("uxV11WelcomeOpenImport")?.addEventListener("click", () => {
			markOnboarded()
			this.openImportImageTab()
			dismiss()
		})
		document.getElementById("uxV11WelcomeOpenHelp")?.addEventListener("click", () => {
			markOnboarded()
			const helpEl = document.getElementById("helpModal")
			if (helpEl) Modal.getOrCreateInstance(helpEl).show()
			dismiss()
		})

		// Auto-dismiss after 30 s if the user doesn't interact.
		const auto = setTimeout(() => {
			if (document.body.contains(card)) dismiss()
		}, ONBOARDING_AUTOHIDE_MS)
		// If the card is removed early (via dismiss), cancel the auto-timer.
		const observer = new MutationObserver(() => {
			if (!document.body.contains(card)) {
				clearTimeout(auto)
				observer.disconnect()
			}
		})
		observer.observe(host, { childList: true })

		// Keep applyTranslations idempotent for the toast contents (in case of
		// late locale change), although the body is rendered with t() above.
		applyTranslations(card)
	}

	private ensureOnboardingHost(): HTMLDivElement {
		let host = document.getElementById("uxV11WelcomeHost") as HTMLDivElement | null
		if (host) return host
		host = document.createElement("div")
		host.id = "uxV11WelcomeHost"
		document.body.appendChild(host)
		return host
	}

	// ----------------------------------------------------------------------
	// Storage sync — same-tab listener (StorageEvent only fires across tabs).
	// We monkey-patch localStorage.setItem to broadcast within this tab too,
	// scoped to circuitvision.* keys, so the chips refresh as soon as the user
	// hits Save in the AI provider settings panel.
	// ----------------------------------------------------------------------
	private bindStorageSync(): void {
		const orig = localStorage.setItem.bind(localStorage)
		localStorage.setItem = (key: string, value: string) => {
			orig(key, value)
			if (key && key.startsWith("circuitvision.")) {
				// Defer to next tick so the caller's UI work finishes first.
				setTimeout(() => this.refreshAiProviderChips(), 0)
			}
		}
	}

	// ----------------------------------------------------------------------
	// Tooltip refresh — initialise tooltips on the new dropdown toggles and
	// the version / AI chips, since MainController.updateTooltips runs once
	// during construction (before our markup is in scope of that controller).
	// ----------------------------------------------------------------------
	private refreshTooltipsForNewElements(): void {
		const sel = "[data-bs-toggle=\"tooltip\"], [data-bs-toggle-second=\"tooltip\"]"
		document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
			// Don't double-init.
			if (Tooltip.getInstance(el)) return
			try {
				Tooltip.getOrCreateInstance(el)
			} catch {
				// Bootstrap throws if the element isn't compatible — ignore.
			}
		})
		// Also ask MainController to refresh, in case it's already running and
		// our additions slipped in after its first sweep. updateTooltips is
		// idempotent (it skips elements that already have a tooltip instance).
		try {
			const mc = MainController.instance as unknown as { updateTooltips?: () => void }
			mc.updateTooltips?.()
		} catch {
			// silent — MainController may not have finished construction yet.
		}
	}
}

/** Convenience exports for index.ts to keep the bootstrap small. */

export function bindVersionLabelUxV11(): void {
	UxV11Controller.instance.bindAll()
}
export function bindOnboardingHintUxV11(): void {
	UxV11Controller.instance.bindAll()
}
export function bindStatusBarProviderUxV11(): void {
	UxV11Controller.instance.bindAll()
}
export function bindShortcutOverlayUxV11(): void {
	UxV11Controller.instance.bindAll()
}
