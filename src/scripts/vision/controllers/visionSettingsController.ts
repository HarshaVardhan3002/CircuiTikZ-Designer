// src/scripts/vision/controllers/visionSettingsController.ts
import {
	getProvider,
	type ProviderConfig,
	type ProviderId,
} from "../visionProvider"
import {
	getActiveProviderId,
	loadProviderConfig,
	saveProviderConfig,
	setActiveProviderId,
} from "../storage/providerStorage"

const DEFAULT_BASE_URLS: Record<string, string> = {
	"openai-compat": "https://api.openai.com/v1",
	anthropic: "https://api.anthropic.com",
	gemini: "https://generativelanguage.googleapis.com",
}

/**
 * Owner of the AI Provider section in the settings modal. Reads/writes provider configuration in
 * localStorage via {@link providerStorage} and exposes a "Test connection" button so the user can
 * verify a configuration before they ever try to detect from an image.
 */
export class VisionSettingsController {
	private static _instance: VisionSettingsController
	public static get instance(): VisionSettingsController {
		return (this._instance ??= new VisionSettingsController())
	}

	private select!: HTMLSelectElement
	private baseUrl!: HTMLInputElement
	private apiKey!: HTMLInputElement
	private model!: HTMLInputElement
	private saveBtn!: HTMLButtonElement
	private testBtn!: HTMLButtonElement
	private testResult!: HTMLSpanElement

	private bound = false

	private constructor() {}

	/** Bind to the markup. Called once on app start, after the DOM exists. */
	public bind(): void {
		if (this.bound) return
		const select = document.getElementById("aiProviderSelect") as HTMLSelectElement | null
		if (!select) return // markup absent — silently no-op so the rest of the app still boots

		this.select = select
		this.baseUrl = document.getElementById("aiProviderBaseUrl") as HTMLInputElement
		this.apiKey = document.getElementById("aiProviderApiKey") as HTMLInputElement
		this.model = document.getElementById("aiProviderModel") as HTMLInputElement
		this.saveBtn = document.getElementById("aiProviderSaveBtn") as HTMLButtonElement
		this.testBtn = document.getElementById("aiProviderTestBtn") as HTMLButtonElement
		this.testResult = document.getElementById("aiProviderTestResult") as HTMLSpanElement

		this.select.addEventListener("change", () => this.loadIntoForm(this.select.value as ProviderId))
		this.saveBtn.addEventListener("click", () => this.save())
		this.testBtn.addEventListener("click", () => {
			void this.test()
		})

		const activeId = getActiveProviderId() ?? ("openai-compat" as ProviderId)
		this.select.value = activeId
		this.loadIntoForm(activeId)

		this.bound = true
	}

	private loadIntoForm(id: ProviderId): void {
		const cfg = loadProviderConfig(id)
		this.baseUrl.placeholder = DEFAULT_BASE_URLS[id] ?? ""
		this.baseUrl.value = cfg?.baseUrl ?? ""
		this.apiKey.value = cfg?.apiKey ?? ""
		this.model.value = cfg?.model ?? ""
		this.testResult.textContent = ""
		this.testResult.style.color = ""
	}

	private currentFormConfig(): ProviderConfig {
		return {
			providerId: this.select.value as ProviderId,
			baseUrl: this.baseUrl.value.trim() || undefined,
			apiKey: this.apiKey.value,
			model: this.model.value.trim(),
		}
	}

	private save(): void {
		const cfg = this.currentFormConfig()
		const provider = getProvider(cfg.providerId)
		if (!provider) {
			this.flash("Provider not registered.", false)
			return
		}
		const v = provider.validateConfig(cfg)
		if (!v.ok) {
			this.flash(v.errors.join(" "), false)
			return
		}
		saveProviderConfig(cfg)
		setActiveProviderId(cfg.providerId)
		this.flash("Saved.", true)
	}

	private async test(): Promise<void> {
		const cfg = this.currentFormConfig()
		const provider = getProvider(cfg.providerId)
		if (!provider?.testConnection) {
			this.flash("Provider has no connectivity test.", false)
			return
		}
		this.testResult.textContent = "Testing…"
		this.testResult.style.color = ""
		try {
			const r = await provider.testConnection(cfg)
			if (r.ok) this.flash("Reachable.", true)
			else this.flash(`Failed: ${r.errors.join(" ")}`, false)
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			this.flash(`Failed: ${msg}`, false)
		}
	}

	private flash(msg: string, ok: boolean): void {
		this.testResult.textContent = msg
		this.testResult.style.color = ok ? "#4caf50" : "#e57373"
	}
}
