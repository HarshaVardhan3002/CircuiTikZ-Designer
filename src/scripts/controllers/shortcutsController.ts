import { MainController } from "../internal"
import { t } from "../i18n"

/**
 * The keyboard-shortcut cheat-sheet rendered inside the Help modal (#helpShortcuts). This array is
 * the single source of truth for what we advertise - keep it in sync with MainController.initShortcuts.
 * Keys are written in a normalized token form ("mod+shift+O", "Q", "arrows") and rendered per-platform:
 * `mod` -> Ctrl on Windows/Linux, ⌘ on macOS; shift -> ⇧, alt -> ⌥, etc. So one definition serves both.
 */
type Shortcut = { keys: string; labelKey: string }
type Group = { titleKey: string; items: Shortcut[]; note?: string }

const GROUPS: Group[] = [
	{
		titleKey: "shortcuts.group.file",
		items: [
			{ keys: "mod+O", labelKey: "shortcuts.load" },
			{ keys: "mod+S", labelKey: "shortcuts.save" },
			{ keys: "mod+shift+O", labelKey: "shortcuts.import" },
			{ keys: "mod+E", labelKey: "shortcuts.exportTikz" },
			{ keys: "mod+shift+E", labelKey: "shortcuts.exportSvg" },
		],
	},
	{
		titleKey: "shortcuts.group.edit",
		items: [
			{ keys: "mod+Z", labelKey: "shortcuts.undo" },
			{ keys: "mod+shift+Z", labelKey: "shortcuts.redo" },
			{ keys: "mod+C", labelKey: "shortcuts.copy" },
			{ keys: "mod+X", labelKey: "shortcuts.cut" },
			{ keys: "mod+V", labelKey: "shortcuts.paste" },
			{ keys: "mod+A", labelKey: "shortcuts.selectAll" },
			{ keys: "del", labelKey: "shortcuts.delete" },
			{ keys: "mod+R", labelKey: "shortcuts.rotateCcw" },
			{ keys: "mod+shift+R", labelKey: "shortcuts.rotateCw" },
			{ keys: "shift+X", labelKey: "shortcuts.flipH" },
			{ keys: "shift+Y", labelKey: "shortcuts.flipV" },
			{ keys: "arrows", labelKey: "shortcuts.nudge" },
			{ keys: "shift+arrows", labelKey: "shortcuts.nudgeBig" },
		],
	},
	{
		titleKey: "shortcuts.group.tools",
		items: [
			{ keys: "Q", labelKey: "shortcuts.drawer" },
			{ keys: "W", labelKey: "shortcuts.wire" },
			{ keys: "T", labelKey: "shortcuts.text" },
			{ keys: "Esc", labelKey: "shortcuts.select" },
			{ keys: "Enter", labelKey: "shortcuts.finish" },
			{ keys: "mod+K", labelKey: "shortcuts.palette" },
			{ keys: "shift+/", labelKey: "shortcuts.help" },
		],
	},
	{
		titleKey: "shortcuts.group.components",
		note: "shortcuts.altNote",
		items: [
			{ keys: "G", labelKey: "shortcuts.ground" },
			{ keys: "R", labelKey: "shortcuts.resistor" },
			{ keys: "C", labelKey: "shortcuts.capacitor" },
			{ keys: "L", labelKey: "shortcuts.inductor" },
			{ keys: "D", labelKey: "shortcuts.diode" },
			{ keys: "B", labelKey: "shortcuts.npn" },
			{ keys: "N", labelKey: "shortcuts.nmos" },
			{ keys: "X", labelKey: "shortcuts.crossing" },
			{ keys: ".", labelKey: "shortcuts.terminal" },
		],
	},
]

export class ShortcutsController {
	private static _instance: ShortcutsController
	public static get instance(): ShortcutsController {
		return (ShortcutsController._instance ??= new ShortcutsController())
	}

	private host: HTMLElement | null = null

	/** Render the cheat-sheet into #helpShortcuts and re-render on language change. Call once at boot. */
	public bind(): void {
		this.host = document.getElementById("helpShortcuts")
		if (!this.host) return
		this.injectStyle()
		this.render()
		window.addEventListener("locale-changed", () => this.render())
	}

	private injectStyle(): void {
		if (document.getElementById("ctkShortcutsStyle")) return
		const css = `
		#helpShortcuts .ctk-sc-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:10px}
		#helpShortcuts .ctk-sc-plat{font-size:12px;color:var(--c-fg-muted,#888)}
		.ctk-sc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px 28px;margin-bottom:6px}
		.ctk-sc-group h6{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--c-fg-muted,#888);margin:0 0 7px;font-weight:600}
		.ctk-sc-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:3px 0}
		.ctk-sc-label{font-size:13.5px;color:var(--c-fg,inherit)}
		.ctk-sc-keys{display:inline-flex;gap:3px;flex:0 0 auto}
		kbd.ctk-kbd{display:inline-block;min-width:20px;text-align:center;padding:2px 6px;border-radius:6px;font-family:var(--font-mono,ui-monospace,monospace);font-size:12px;line-height:1.35;
			background:color-mix(in srgb, var(--c-fg,#000) 8%, transparent);color:var(--c-fg,inherit);border:1px solid var(--c-border,rgba(0,0,0,.15));box-shadow:0 1px 0 var(--c-border-strong,rgba(0,0,0,.2))}
		.ctk-sc-note{font-size:12px;color:var(--c-fg-muted,#888);font-style:italic;margin-top:5px}
		`
		const s = document.createElement("style")
		s.id = "ctkShortcutsStyle"
		s.textContent = css
		document.head.appendChild(s)
	}

	private render(): void {
		if (!this.host) return
		const mac = MainController.instance?.isMac ?? false
		const groupsHtml = GROUPS.map((g) => {
			const rows = g.items
				.map(
					(it) =>
						`<div class="ctk-sc-row"><span class="ctk-sc-label">${escapeHtml(t(it.labelKey))}</span><span class="ctk-sc-keys">${renderKeys(it.keys, mac)}</span></div>`
				)
				.join("")
			const note = g.note ? `<div class="ctk-sc-note">${escapeHtml(t(g.note))}</div>` : ""
			return `<div class="ctk-sc-group"><h6>${escapeHtml(t(g.titleKey))}</h6>${rows}${note}</div>`
		}).join("")

		this.host.innerHTML =
			`<div class="ctk-sc-head"><h1 class="fs-4 m-0">${escapeHtml(t("shortcuts.title"))}</h1>` +
			`<span class="ctk-sc-plat">${escapeHtml(t("shortcuts.platformNote", { platform: mac ? "macOS" : "Windows / Linux" }))}</span></div>` +
			`<div class="ctk-sc-grid">${groupsHtml}</div>`
	}
}

/** Render one normalized key-combo (e.g. "mod+shift+O") as a run of platform-appropriate <kbd> chips. */
function renderKeys(keys: string, mac: boolean): string {
	if (keys === "shift+/") return `<kbd class="ctk-kbd">?</kbd>` // the ? key itself
	const chips: string[] = []
	for (const p of keys.split("+")) {
		if (p === "arrows") {
			chips.push("↑", "↓", "←", "→")
		} else if (p === "mod") {
			chips.push(mac ? "⌘" : "Ctrl")
		} else if (p === "shift") {
			chips.push(mac ? "⇧" : "Shift")
		} else if (p === "alt") {
			chips.push(mac ? "⌥" : "Alt")
		} else if (p === "del") {
			chips.push(mac ? "⌫" : "Del")
		} else if (p === "Enter") {
			chips.push(mac ? "⏎" : "Enter")
		} else {
			chips.push(p)
		}
	}
	return chips.map((c) => `<kbd class="ctk-kbd">${escapeHtml(c)}</kbd>`).join("")
}

function escapeHtml(s: string): string {
	return s.replace(
		/[&<>"']/g,
		(ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string
	)
}
