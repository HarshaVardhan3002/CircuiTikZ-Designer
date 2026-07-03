/**
 * Command palette - a Spotlight / VS-Code-style overlay that lets the user trigger any
 * action by typing. Bound to Ctrl/⌘ + K.
 *
 * Items are registered by feature controllers (each adds its own; no central registry),
 * so the palette grows automatically as new features land. Fuzzy matching is hand-rolled
 * (subsequence match, weighted by contiguity and word boundaries) - small, dependency-free,
 * good enough for a list of ~50 items.
 */

import { t } from "../i18n"

export interface CommandItem {
	/** Stable id used for keyboard hints and analytics. */
	id: string
	/** The localised title shown in the row. Use a getter if it should re-translate on
	 *  locale changes (we re-render on every open, so a getter works fine). */
	title: () => string
	description?: () => string
	/** Material Symbols icon name. */
	icon?: string
	/** Section header this item lives under. */
	section: string
	/** Optional shortcut hint (e.g. "Q", "Ctrl+S"). */
	shortcut?: string
	/** Match this against extra keywords on top of the title for fuzzy search. */
	keywords?: string[]
	/** Run the command. */
	run: () => void
}

export class CommandPaletteController {
	private static _instance: CommandPaletteController | null = null
	public static get instance(): CommandPaletteController {
		return CommandPaletteController._instance ??
			(CommandPaletteController._instance = new CommandPaletteController())
	}

	private items: CommandItem[] = []
	private isOpen = false
	private selectedIdx = 0
	private filtered: CommandItem[] = []

	private backdrop!: HTMLDivElement
	private modal!: HTMLDivElement
	private input!: HTMLInputElement
	private resultsEl!: HTMLDivElement

	private constructor() {
		this.buildDom()
		this.bindGlobalShortcut()
	}

	public register(item: CommandItem) {
		// Replace by id so callers can re-register with updated runners idempotently.
		const existing = this.items.findIndex((i) => i.id === item.id)
		if (existing >= 0) this.items[existing] = item
		else this.items.push(item)
	}

	public registerMany(items: CommandItem[]) {
		for (const it of items) this.register(it)
	}

	public open() {
		if (this.isOpen) return
		this.isOpen = true
		this.input.value = ""
		this.refresh("")
		this.backdrop.classList.add("open")
		// Defer focus so the open animation doesn't get aborted.
		requestAnimationFrame(() => this.input.focus())
	}

	public close() {
		if (!this.isOpen) return
		this.isOpen = false
		this.backdrop.classList.remove("open")
	}

	private buildDom() {
		const backdrop = document.createElement("div")
		backdrop.id = "commandPaletteBackdrop"

		const modal = document.createElement("div")
		modal.id = "commandPalette"
		modal.setAttribute("role", "dialog")
		modal.setAttribute("aria-label", "Command palette")

		modal.innerHTML = `
			<div class="cp-input-row">
				<span class="material-symbols-outlined cp-icon">search</span>
				<input type="text" id="cpInput" autocomplete="off" spellcheck="false" />
				<span class="cp-hint">Esc</span>
			</div>
			<div class="cp-results" id="cpResults" role="listbox"></div>
			<div class="cp-footer">
				<span class="cp-footer-key"><kbd>↑</kbd><kbd>↓</kbd> ${t("cmd.navigate")}</span>
				<span class="cp-footer-key"><kbd>↵</kbd> ${t("cmd.toRun")}</span>
				<span class="cp-footer-key"><kbd>Esc</kbd> ${t("cmd.toClose")}</span>
			</div>
		`

		backdrop.appendChild(modal)
		document.body.appendChild(backdrop)

		this.backdrop = backdrop
		this.modal = modal
		this.input = modal.querySelector("#cpInput") as HTMLInputElement
		this.resultsEl = modal.querySelector("#cpResults") as HTMLDivElement
		this.input.placeholder = t("cmd.placeholder")

		// Close when clicking the backdrop (but not the modal itself).
		backdrop.addEventListener("mousedown", (ev) => {
			if (ev.target === backdrop) this.close()
		})

		this.input.addEventListener("input", () => this.refresh(this.input.value))
		this.input.addEventListener("keydown", (ev) => this.onKeyDown(ev))

		// Re-translate placeholder/footer on locale change.
		window.addEventListener("locale-changed", () => {
			this.input.placeholder = t("cmd.placeholder")
			modal.querySelector(".cp-footer")!.innerHTML = `
				<span class="cp-footer-key"><kbd>↑</kbd><kbd>↓</kbd> ${t("cmd.navigate")}</span>
				<span class="cp-footer-key"><kbd>↵</kbd> ${t("cmd.toRun")}</span>
				<span class="cp-footer-key"><kbd>Esc</kbd> ${t("cmd.toClose")}</span>
			`
			if (this.isOpen) this.refresh(this.input.value)
		})
	}

	private bindGlobalShortcut() {
		document.addEventListener("keydown", (ev) => {
			const isCmdK = (ev.ctrlKey || ev.metaKey) && (ev.key === "k" || ev.key === "K")
			if (isCmdK) {
				ev.preventDefault()
				if (this.isOpen) this.close()
				else this.open()
			}
		})
	}

	private onKeyDown(ev: KeyboardEvent) {
		switch (ev.key) {
			case "Escape":
				ev.preventDefault()
				this.close()
				break
			case "ArrowDown":
				ev.preventDefault()
				this.selectedIdx = Math.min(this.filtered.length - 1, this.selectedIdx + 1)
				this.renderSelection()
				break
			case "ArrowUp":
				ev.preventDefault()
				this.selectedIdx = Math.max(0, this.selectedIdx - 1)
				this.renderSelection()
				break
			case "Enter":
				ev.preventDefault()
				this.runSelected()
				break
		}
	}

	private refresh(query: string) {
		const q = query.trim().toLowerCase()
		const all = this.items
		const scored: Array<{ item: CommandItem; score: number; ranges: Array<[number, number]> }> = []

		for (const it of all) {
			const haystack = (it.title() + " " + (it.description?.() ?? "") + " " + (it.keywords ?? []).join(" ")).toLowerCase()
			if (q === "") {
				scored.push({ item: it, score: 0, ranges: [] })
				continue
			}
			const m = fuzzyMatch(haystack, q)
			if (m) scored.push({ item: it, score: m.score, ranges: m.titleRanges(it.title().toLowerCase(), q) })
		}
		scored.sort((a, b) => b.score - a.score || a.item.title().localeCompare(b.item.title()))

		this.filtered = scored.map((s) => s.item)
		this.selectedIdx = 0
		this.renderResults(scored, q)
	}

	private renderResults(
		scored: Array<{ item: CommandItem; score: number; ranges: Array<[number, number]> }>,
		query: string
	) {
		if (scored.length === 0) {
			this.resultsEl.innerHTML = `<div class="cp-empty">${t("cmd.empty")}</div>`
			return
		}

		// Group by section, preserving order of first appearance for stable layout.
		const sections = new Map<string, typeof scored>()
		for (const s of scored) {
			const arr = sections.get(s.item.section) ?? []
			arr.push(s)
			sections.set(s.item.section, arr)
		}

		const out: string[] = []
		let flatIdx = 0
		for (const [section, rows] of sections) {
			out.push(`<div class="cp-section">${escapeHtml(section)}</div>`)
			for (const r of rows) {
				const isSelected = flatIdx === this.selectedIdx
				const title = highlight(r.item.title(), query)
				const desc = r.item.description?.()
				out.push(`
					<div class="cp-item" role="option" data-idx="${flatIdx}" aria-selected="${isSelected}">
						<span class="material-symbols-outlined cp-item-icon">${r.item.icon ?? "bolt"}</span>
						<div class="cp-item-body">
							<span class="cp-item-title">${title}</span>
							${desc ? `<span class="cp-item-desc">${escapeHtml(desc)}</span>` : ""}
						</div>
						${r.item.shortcut ? `<span class="cp-item-shortcut">${escapeHtml(r.item.shortcut)}</span>` : ""}
					</div>
				`)
				flatIdx++
			}
		}
		this.resultsEl.innerHTML = out.join("")

		// Wire up clicks.
		this.resultsEl.querySelectorAll<HTMLElement>(".cp-item").forEach((el) => {
			el.addEventListener("mousemove", () => {
				const i = Number(el.dataset.idx ?? "0")
				if (this.selectedIdx !== i) {
					this.selectedIdx = i
					this.renderSelection()
				}
			})
			el.addEventListener("mousedown", (ev) => {
				ev.preventDefault()
				const i = Number(el.dataset.idx ?? "0")
				this.selectedIdx = i
				this.runSelected()
			})
		})
	}

	private renderSelection() {
		this.resultsEl.querySelectorAll<HTMLElement>(".cp-item").forEach((el) => {
			const i = Number(el.dataset.idx ?? "0")
			el.setAttribute("aria-selected", i === this.selectedIdx ? "true" : "false")
			if (i === this.selectedIdx) {
				el.scrollIntoView({ block: "nearest" })
			}
		})
	}

	private runSelected() {
		const item = this.filtered[this.selectedIdx]
		if (!item) return
		this.close()
		// Defer execution so the close animation gets a frame to start.
		requestAnimationFrame(() => item.run())
	}
}

// ---------- fuzzy match (compact, dependency-free) ---------------------------

/**
 * Subsequence-match `query` against `haystack`. Returns null if not all chars hit;
 * else a score that rewards contiguous matches and word-boundary hits.
 */
function fuzzyMatch(haystack: string, query: string): { score: number; titleRanges: (title: string, q: string) => Array<[number, number]> } | null {
	let score = 0
	let qi = 0
	let lastMatchIdx = -2
	for (let i = 0; i < haystack.length && qi < query.length; i++) {
		if (haystack[i] === query[qi]) {
			let bonus = 1
			if (lastMatchIdx === i - 1) bonus += 4 // contiguous
			if (i === 0 || haystack[i - 1] === " " || haystack[i - 1] === "-") bonus += 3 // word boundary
			score += bonus
			lastMatchIdx = i
			qi++
		}
	}
	if (qi < query.length) return null
	return {
		score,
		titleRanges: (title: string, q: string) => collectRanges(title, q),
	}
}

function collectRanges(title: string, q: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = []
	let qi = 0
	let curStart = -1
	for (let i = 0; i < title.length && qi < q.length; i++) {
		if (title[i] === q[qi]) {
			if (curStart < 0) curStart = i
			qi++
			if (qi === q.length || title[i + 1] !== q[qi]) {
				ranges.push([curStart, i + 1])
				curStart = -1
			}
		}
	}
	return ranges
}

function highlight(text: string, q: string): string {
	if (!q) return escapeHtml(text)
	const lower = text.toLowerCase()
	const ranges = collectRanges(lower, q.toLowerCase())
	if (ranges.length === 0) return escapeHtml(text)

	let out = ""
	let cursor = 0
	for (const [s, e] of ranges) {
		out += escapeHtml(text.slice(cursor, s))
		out += "<mark>" + escapeHtml(text.slice(s, e)) + "</mark>"
		cursor = e
	}
	out += escapeHtml(text.slice(cursor))
	return out
}

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => {
		switch (c) {
			case "&":
				return "&amp;"
			case "<":
				return "&lt;"
			case ">":
				return "&gt;"
			case '"':
				return "&quot;"
			case "'":
				return "&#39;"
			default:
				return c
		}
	})
}
