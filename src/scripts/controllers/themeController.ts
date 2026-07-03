/**
 * Single source of truth for the two orthogonal UI preferences:
 *   - **theme**: which colour palette the app renders with (10 named themes).
 *   - **uiMode**: "modern" (the polished design system) vs "classic" (legacy Bootstrap look).
 *
 * Storage:
 *   - localStorage key `ctd-theme`     - the active theme id.
 *   - localStorage key `ctd-ui-mode`   - the active UI mode ("modern" by default).
 *
 * On first construction we migrate the legacy `circuitikz-designer-theme` key (which the
 * old MainController used to store just "dark"|"light") into `ctd-theme`, then delete the
 * old key. The result is one storage path, one writer of `data-bs-theme`, one writer of
 * the `theme-*` and `ui-*` html classes.
 *
 * Callers can react to changes by listening for the `theme-changed` and `ui-mode-changed`
 * CustomEvents on `window`.
 */

export type ThemeId =
	| "modern-light"
	| "modern-dark"
	| "amoled"
	| "peach"
	| "sky"
	| "forest"
	| "nord"
	| "bauhaus"
	| "classic-light"
	| "classic-dark"

export type UiMode = "modern" | "classic"

/** Per-theme metadata - used by the command palette + the floating theme picker. */
export type ThemeMeta = {
	id: ThemeId
	/** i18n key for the user-visible label (e.g. "theme.modernLight"). */
	labelKey: string
	/** Material-symbols glyph name for the picker icon (e.g. "light_mode"). */
	iconClass: string
	/** Search keywords for the command palette (lower-case, mixed languages). */
	keywords: string[]
}

/**
 * Canonical theme catalogue. Adding a theme: append one entry here and add the matching
 * SCSS block in `themes.scss` + the matching i18n strings - that's it. The command
 * palette and the picker menu both iterate this list.
 */
export const THEME_META: ThemeMeta[] = [
	{ id: "modern-light",  labelKey: "theme.modernLight",  iconClass: "light_mode",        keywords: [] },
	{ id: "modern-dark",   labelKey: "theme.modernDark",   iconClass: "dark_mode",         keywords: [] },
	{ id: "amoled",        labelKey: "theme.amoled",       iconClass: "contrast",          keywords: ["black", "oled", "schwarz"] },
	{ id: "peach",         labelKey: "theme.peach",        iconClass: "local_florist",     keywords: ["coral", "warm", "pfirsich"] },
	{ id: "sky",           labelKey: "theme.sky",          iconClass: "wb_sunny",          keywords: ["blue", "cyan", "blau", "himmelblau"] },
	{ id: "forest",        labelKey: "theme.forest",       iconClass: "park",              keywords: ["green", "moss", "wald", "grün"] },
	{ id: "nord",          labelKey: "theme.nord",         iconClass: "ac_unit",           keywords: ["arctic", "blue grey"] },
	{ id: "bauhaus",       labelKey: "theme.bauhaus",      iconClass: "grid_view",         keywords: ["red", "primary", "german"] },
	{ id: "classic-light", labelKey: "theme.classicLight", iconClass: "wb_incandescent",   keywords: [] },
	{ id: "classic-dark",  labelKey: "theme.classicDark",  iconClass: "nights_stay",       keywords: [] },
]

const THEMES: ThemeId[] = THEME_META.map((m) => m.id)
const UI_MODES: UiMode[] = ["modern", "classic"]

/** Ordered groups for the theme picker menu. */
export const THEME_GROUPS: Array<{ label: string; themes: ThemeId[] }> = [
	{ label: "Modern", themes: ["modern-light", "modern-dark", "amoled"] },
	{ label: "Coloured", themes: ["peach", "sky", "forest", "nord", "bauhaus"] },
	{ label: "Classic", themes: ["classic-light", "classic-dark"] },
]

/** Look up a theme's metadata by id. Falls back to a synthetic entry for safety. */
export function getThemeMeta(id: ThemeId): ThemeMeta {
	return THEME_META.find((m) => m.id === id) ?? { id, labelKey: id, iconClass: "palette", keywords: [] }
}

const LEGACY_THEME_KEY = "circuitikz-designer-theme"
const THEME_KEY = "ctd-theme"
const UI_MODE_KEY = "ctd-ui-mode"

export class ThemeController {
	private static _instance: ThemeController | null = null
	public static get instance(): ThemeController {
		return ThemeController._instance ?? (ThemeController._instance = new ThemeController())
	}

	private _theme: ThemeId = "modern-light"
	private _uiMode: UiMode = "modern"

	private constructor() {
		// One-time migration of the legacy MainController key: read its value, write it
		// (translated to the equivalent named theme), then delete it so we never look at
		// the old key again on subsequent loads.
		this.migrateLegacyThemeKey()

		this._theme = this.readStoredTheme()
		this._uiMode = this.readStoredUiMode()
		this.applyTheme()
		this.applyUiMode()

		// Track OS-level dark-mode preference for first-time visitors only.
		if (!localStorage.getItem(THEME_KEY)) {
			const m = window.matchMedia("(prefers-color-scheme: dark)")
			if (m.matches) this.setTheme("modern-dark")
			m.addEventListener?.("change", (ev) => {
				if (!localStorage.getItem(THEME_KEY)) {
					this.setTheme(ev.matches ? "modern-dark" : "modern-light")
				}
			})
		}
	}

	public get theme(): ThemeId {
		return this._theme
	}
	public get uiMode(): UiMode {
		return this._uiMode
	}

	public get themes(): ThemeId[] {
		return THEMES.slice()
	}
	public get uiModes(): UiMode[] {
		return UI_MODES.slice()
	}

	public setTheme(t: ThemeId) {
		if (!THEMES.includes(t)) return
		this._theme = t
		localStorage.setItem(THEME_KEY, t)
		this.applyTheme()
		window.dispatchEvent(new CustomEvent("theme-changed", { detail: t }))
	}

	public setUiMode(m: UiMode) {
		if (!UI_MODES.includes(m)) return
		this._uiMode = m
		localStorage.setItem(UI_MODE_KEY, m)
		this.applyUiMode()
		window.dispatchEvent(new CustomEvent("ui-mode-changed", { detail: m }))
	}

	/** Cycle through a sensible dark/light pair given the active theme. */
	public toggleDark() {
		// Each light theme has an obvious dark pair; map them so the toggle does something
		// reasonable no matter which themed palette the user is on.
		const pairs: Record<ThemeId, ThemeId> = {
			"modern-light": "modern-dark",
			"modern-dark": "modern-light",
			amoled: "modern-light",
			peach: "modern-dark",
			sky: "nord",
			nord: "sky",
			forest: "modern-light",
			bauhaus: "modern-dark",
			"classic-light": "classic-dark",
			"classic-dark": "classic-light",
		}
		this.setTheme(pairs[this._theme] ?? "modern-light")
	}

	/** True when the active theme renders on a dark background. */
	public get isDark(): boolean {
		return ["modern-dark", "amoled", "forest", "nord", "classic-dark"].includes(this._theme)
	}

	/**
	 * Toggle between a light and a dark theme - kept as a convenience so the rest of the
	 * codebase has a one-call way to "force light" / "force dark" without juggling pairs.
	 * Returns the resulting theme id.
	 */
	public setDark(dark: boolean): ThemeId {
		if (dark === this.isDark) return this._theme
		this.toggleDark()
		return this._theme
	}

	/**
	 * Read the legacy MainController storage key (which only ever held "dark" or "light")
	 * and translate it into the equivalent named theme, then remove the old key.
	 * Subsequent reads only ever see `ctd-theme`.
	 */
	private migrateLegacyThemeKey(): void {
		try {
			const legacy = localStorage.getItem(LEGACY_THEME_KEY)
			if (legacy === null) return
			// Only adopt the legacy value if no canonical value already exists, otherwise
			// the canonical value wins (it was written by a newer codepath).
			if (!localStorage.getItem(THEME_KEY)) {
				const mapped: ThemeId = legacy === "dark" ? "modern-dark" : "modern-light"
				localStorage.setItem(THEME_KEY, mapped)
			}
			localStorage.removeItem(LEGACY_THEME_KEY)
		} catch {
			// localStorage can throw in private-mode Safari - ignore, defaults take over.
		}
	}

	private readStoredTheme(): ThemeId {
		const stored = localStorage.getItem(THEME_KEY) as ThemeId | null
		if (stored && THEMES.includes(stored)) return stored
		// Default: warm light, but flip to dark if the OS asks for it.
		return window.matchMedia("(prefers-color-scheme: dark)").matches ? "modern-dark" : "modern-light"
	}
	private readStoredUiMode(): UiMode {
		const stored = localStorage.getItem(UI_MODE_KEY) as UiMode | null
		return stored && UI_MODES.includes(stored) ? stored : "modern"
	}

	private applyTheme() {
		const html = document.documentElement
		for (const t of THEMES) html.classList.remove("theme-" + t)
		html.classList.add("theme-" + this._theme)
		// Bootstrap data attribute for any built-in component still reading it.
		html.setAttribute("data-bs-theme", this.isDark ? "dark" : "light")
	}
	private applyUiMode() {
		const html = document.documentElement
		for (const m of UI_MODES) html.classList.remove("ui-" + m)
		html.classList.add("ui-" + this._uiMode)
	}

	/**
	 * Mount a `<select>` UI-mode picker into the slot left by `index.html` inside the
	 * settings modal. Idempotent - a repeat call just refreshes the current selection.
	 */
	public installUiModePicker(): void {
		const slot = document.getElementById("uiModeSelectorSlot")
		if (!slot) return
		// Reuse the existing select if we've already rendered one (e.g. picker re-bound
		// after a locale switch).
		let select = slot.querySelector("select#uiModeSelect") as HTMLSelectElement | null
		if (!select) {
			slot.innerHTML = ""
			const wrap = document.createElement("div")
			wrap.className = "settings-section mb-4"

			const heading = document.createElement("h5")
			heading.textContent = "UI mode"
			heading.setAttribute("data-i18n", "settings.uiMode.title")
			wrap.appendChild(heading)

			const help = document.createElement("p")
			help.className = "text-muted small mb-2"
			help.textContent =
				"Choose how the interface looks. Modern is the polished default; Classic is the original Bootstrap look kept for parity."
			help.setAttribute("data-i18n", "settings.uiMode.help")
			wrap.appendChild(help)

			const label = document.createElement("label")
			label.className = "form-label"
			label.htmlFor = "uiModeSelect"
			label.textContent = "Layout"
			label.setAttribute("data-i18n", "settings.uiMode.label")
			wrap.appendChild(label)

			select = document.createElement("select")
			select.id = "uiModeSelect"
			select.className = "form-select form-select-sm"

			const optModern = document.createElement("option")
			optModern.value = "modern"
			optModern.textContent = "Modern (recommended)"
			optModern.setAttribute("data-i18n", "settings.uiMode.modern")
			select.appendChild(optModern)

			const optClassic = document.createElement("option")
			optClassic.value = "classic"
			optClassic.textContent = "Classic (legacy)"
			optClassic.setAttribute("data-i18n", "settings.uiMode.classic")
			select.appendChild(optClassic)

			select.addEventListener("change", () => {
				const v = select!.value as UiMode
				this.setUiMode(v)
			})

			wrap.appendChild(select)
			slot.appendChild(wrap)
		}
		// Sync current value every time (cheap, idempotent).
		select.value = this._uiMode
	}
}
