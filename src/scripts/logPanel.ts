import { logBus, type LogEntry, type LogLevel } from "./logBus"

/**
 * Floating log panel. Shows a live, bounded ("moving") view of the central log bus: the most recent
 * rows are kept in the DOM and older ones roll off, colour-coded by level, with a level filter, a
 * clear button, and a "Record" button that downloads the FULL buffer to a local file for later
 * debugging. An error/warn badge on the toggle flags trouble while the panel is closed.
 *
 * Self-contained (injects its own markup + styles) and guarded, so it no-ops cleanly if the DOM is
 * missing. Bound once from index.ts.
 */

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }
const LEVEL_ORDER: LogLevel[] = ["debug", "info", "warn", "error"]

export class LogPanelController {
	private static _instance: LogPanelController
	public static get instance(): LogPanelController {
		return (LogPanelController._instance ??= new LogPanelController())
	}

	private bound = false
	private isOpen = false
	private minLevel: LogLevel = "debug"
	private readonly maxRows = 400
	private unseen = 0

	private toggle!: HTMLButtonElement
	private badge!: HTMLSpanElement
	private panel!: HTMLDivElement
	private list!: HTMLDivElement
	private countEl!: HTMLSpanElement

	public bind(): void {
		if (this.bound) return
		this.injectStyles()
		this.buildUI()
		// Always subscribe: render live when open, otherwise just flag unseen warnings/errors.
		logBus.subscribe((e) => this.onEntry(e))
		this.bound = true
	}

	private injectStyles(): void {
		const css = `
		#ctkLogToggle{position:fixed;left:20px;bottom:20px;z-index:1080;width:46px;height:46px;border-radius:50%;
			border:none;cursor:pointer;background:#334155;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.3);
			display:flex;align-items:center;justify-content:center;font-size:22px}
		#ctkLogToggle .ctkLogBadge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 4px;
			border-radius:9px;background:#e11d48;color:#fff;font-size:11px;font-weight:700;display:none;
			align-items:center;justify-content:center;line-height:18px}
		#ctkLogToggle .ctkLogBadge.show{display:flex}
		#ctkLogPanel{position:fixed;left:20px;bottom:76px;z-index:1080;width:min(520px,94vw);height:min(460px,62vh);
			display:none;flex-direction:column;border-radius:12px;overflow:hidden;background:#0f172a;color:#e2e8f0;
			border:1px solid #1e293b;box-shadow:0 12px 40px rgba(0,0,0,.45);font-size:12px}
		#ctkLogPanel.open{display:flex}
		.ctkLogHead{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#1e293b;border-bottom:1px solid #334155}
		.ctkLogHead .ctkLogTitle{font-weight:600;font-size:13px;margin-right:auto}
		.ctkLogHead select,.ctkLogHead button{background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:6px;
			font-size:12px;padding:3px 7px;cursor:pointer}
		.ctkLogHead button:hover,.ctkLogHead select:hover{border-color:#64748b}
		#ctkLogList{flex:1;overflow-y:auto;padding:6px 8px;font-family:var(--font-mono,ui-monospace,monospace);line-height:1.5}
		.ctkLogRow{display:flex;gap:8px;white-space:pre-wrap;word-break:break-word;padding:1px 0;border-bottom:1px solid rgba(148,163,184,.07)}
		.ctkLogRow .t{color:#64748b;flex:0 0 auto}
		.ctkLogRow .lv{flex:0 0 auto;font-weight:700;text-transform:uppercase}
		.ctkLogRow .src{color:#94a3b8;flex:0 0 auto}
		.ctkLogRow .msg{flex:1 1 auto;color:#cbd5e1}
		.ctkLogRow.debug .lv{color:#64748b}
		.ctkLogRow.info .lv{color:#38bdf8}
		.ctkLogRow.warn{background:rgba(245,158,11,.08)}
		.ctkLogRow.warn .lv{color:#f59e0b}
		.ctkLogRow.error{background:rgba(225,29,72,.12)}
		.ctkLogRow.error .lv{color:#fb7185}
		.ctkLogFoot{padding:5px 10px;background:#1e293b;border-top:1px solid #334155;color:#94a3b8;font-size:11px}`
		const style = document.createElement("style")
		style.id = "ctkLogStyles"
		style.textContent = css
		document.head.appendChild(style)
	}

	private buildUI(): void {
		this.toggle = document.createElement("button")
		this.toggle.id = "ctkLogToggle"
		this.toggle.title = "Logs"
		this.toggle.innerHTML = '<span class="material-symbols-outlined">terminal</span>'
		this.badge = document.createElement("span")
		this.badge.className = "ctkLogBadge"
		this.toggle.appendChild(this.badge)

		this.panel = document.createElement("div")
		this.panel.id = "ctkLogPanel"

		const head = document.createElement("div")
		head.className = "ctkLogHead"
		const title = document.createElement("span")
		title.className = "ctkLogTitle"
		title.textContent = "Logs"

		const filter = document.createElement("select")
		filter.title = "Minimum level"
		for (const lv of LEVEL_ORDER) {
			const o = document.createElement("option")
			o.value = lv
			o.textContent = lv[0].toUpperCase() + lv.slice(1) + "+"
			filter.appendChild(o)
		}
		filter.value = this.minLevel
		filter.addEventListener("change", () => {
			this.minLevel = filter.value as LogLevel
			this.renderAll()
		})

		const recordBtn = document.createElement("button")
		recordBtn.textContent = "Record"
		recordBtn.title = "Download the full log buffer to a file"
		recordBtn.addEventListener("click", () => this.download())

		const clearBtn = document.createElement("button")
		clearBtn.textContent = "Clear"
		clearBtn.addEventListener("click", () => {
			logBus.clear()
			this.renderAll()
		})

		const closeBtn = document.createElement("button")
		closeBtn.textContent = "✕"
		closeBtn.title = "Close"
		closeBtn.addEventListener("click", () => this.setOpen(false))

		head.append(title, filter, recordBtn, clearBtn, closeBtn)

		this.list = document.createElement("div")
		this.list.id = "ctkLogList"

		const foot = document.createElement("div")
		foot.className = "ctkLogFoot"
		this.countEl = document.createElement("span")
		foot.appendChild(this.countEl)

		this.panel.append(head, this.list, foot)
		document.body.append(this.toggle, this.panel)

		this.toggle.addEventListener("click", () => this.setOpen(!this.isOpen))
	}

	private setOpen(open: boolean): void {
		this.isOpen = open
		this.panel.classList.toggle("open", open)
		if (open) {
			this.unseen = 0
			this.updateBadge()
			this.renderAll()
		}
	}

	private passes(e: LogEntry): boolean {
		return LEVEL_RANK[e.level] >= LEVEL_RANK[this.minLevel]
	}

	private onEntry(e: LogEntry): void {
		if (this.isOpen) {
			if (this.passes(e)) this.appendRow(e)
			this.updateCount()
		} else if (e.level === "warn" || e.level === "error") {
			this.unseen++
			this.updateBadge()
		}
	}

	private updateBadge(): void {
		if (this.unseen > 0) {
			this.badge.textContent = this.unseen > 99 ? "99+" : String(this.unseen)
			this.badge.classList.add("show")
		} else {
			this.badge.classList.remove("show")
		}
	}

	private updateCount(): void {
		this.countEl.textContent = logBus.size() + " entries in buffer"
	}

	private fmtTime(t: number): string {
		const d = new Date(t)
		const p = (n: number) => String(n).padStart(2, "0")
		return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds())
	}

	private appendRow(e: LogEntry): void {
		const nearBottom = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 40
		const row = document.createElement("div")
		row.className = "ctkLogRow " + e.level
		row.innerHTML =
			'<span class="t"></span><span class="lv"></span><span class="src"></span><span class="msg"></span>'
		;(row.querySelector(".t") as HTMLElement).textContent = this.fmtTime(e.t)
		;(row.querySelector(".lv") as HTMLElement).textContent = e.level
		;(row.querySelector(".src") as HTMLElement).textContent = e.source
		;(row.querySelector(".msg") as HTMLElement).textContent = e.msg + (e.data ? "  " + e.data : "")
		this.list.appendChild(row)
		while (this.list.childElementCount > this.maxRows) this.list.removeChild(this.list.firstChild as Node)
		if (nearBottom) this.list.scrollTop = this.list.scrollHeight
	}

	private renderAll(): void {
		this.list.textContent = ""
		for (const e of logBus.get({ level: this.minLevel, limit: this.maxRows })) this.appendRow(e)
		this.updateCount()
		this.list.scrollTop = this.list.scrollHeight
	}

	private download(): void {
		const text = logBus.dumpText()
		const blob = new Blob([text], { type: "text/plain;charset=utf-8" })
		const a = document.createElement("a")
		a.href = URL.createObjectURL(blob)
		a.download = "circuitikz-logs-" + new Date().toISOString().replace(/[:.]/g, "-") + ".txt"
		document.body.appendChild(a)
		a.click()
		a.remove()
		setTimeout(() => URL.revokeObjectURL(a.href), 2000)
	}
}
