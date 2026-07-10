/**
 * Central log bus. One place that captures EVERYTHING happening in the app so nothing is silently
 * dropped: console.*, uncaught errors, unhandled promise rejections, every network request/response,
 * and explicit events emitted by the circuit API and the AI chat/harness.
 *
 * Storage is a bounded ring buffer (bounded memory; oldest entries roll off view but the buffer keeps
 * the most recent `cap`). Consumers:
 *   - the moving log panel (UI) subscribes for live entries and can download the full buffer,
 *   - the AI agent reads recent entries via circuitAPI.getLogs() / the get_logs tool to self-diagnose.
 *
 * This module imports nothing from the app, so it has no circular-dependency risk and can be installed
 * as the very first thing at boot.
 */

export type LogLevel = "debug" | "info" | "warn" | "error"
export type LogSource = "console" | "network" | "error" | "tool" | "circuit" | "system"

export interface LogEntry {
	seq: number
	/** epoch ms */
	t: number
	level: LogLevel
	source: LogSource
	msg: string
	/** optional structured payload, stored as a bounded string snapshot */
	data?: string
}

export interface LogFilter {
	level?: LogLevel
	source?: LogSource
	since?: number
	contains?: string
	limit?: number
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

function snapshot(data: unknown, cap = 2000): string | undefined {
	if (data === undefined || data === null) return undefined
	let s: string
	try {
		s = typeof data === "string" ? data : JSON.stringify(data)
	} catch {
		s = String(data)
	}
	if (s === undefined) return undefined
	return s.length > cap ? s.slice(0, cap) + "…[+" + (s.length - cap) + " chars]" : s
}

function asString(v: unknown): string {
	if (typeof v === "string") return v
	try {
		return JSON.stringify(v)
	} catch {
		return String(v)
	}
}

class LogBus {
	private buf: LogEntry[] = []
	private cap = 800
	private seq = 0
	private subs = new Set<(e: LogEntry) => void>()
	private installed = false
	/** The UNPATCHED console methods, captured at install time, used to echo events to DevTools. */
	private origConsole: Partial<Record<LogLevel, (...a: unknown[]) => void>> = {}
	/** Echo structured events to the real DevTools console so nothing lives only in the in-app panel. */
	private echo = true
	/**
	 * Sources that would otherwise be INVISIBLE in the DevTools console and so are echoed there:
	 *  - "console" is skipped: it is already printed by the original console method (would double).
	 *  - "error" is skipped: the browser already prints uncaught errors / rejections natively.
	 * Everything else (network requests, tool/harness calls, circuit edits, system) is echoed.
	 */
	private echoSources: ReadonlySet<LogSource> = new Set<LogSource>(["network", "tool", "circuit", "system"])

	/** Turn the DevTools-console echo on or off at runtime (window.logBus.setEcho(false)). */
	setEcho(on: boolean): void {
		this.echo = on
	}

	/** Record an entry. Never throws. Only ever calls the ORIGINAL console (so the patch can't loop). */
	push(level: LogLevel, source: LogSource, msg: string, data?: unknown): LogEntry {
		const e: LogEntry = {
			seq: ++this.seq,
			t: Date.now(),
			level,
			source,
			msg: snapshot(msg, 2000) ?? "",
			data: snapshot(data),
		}
		this.buf.push(e)
		const over = this.buf.length - this.cap
		if (over > 0) this.buf.splice(0, over)
		// Echo to the real console so API calls / tool calls / circuit edits are visible there too, not
		// only in the in-app panel. Uses the captured ORIGINAL console methods, never the patched ones.
		if (this.echo && this.echoSources.has(source)) {
			const sink = this.origConsole[level] ?? this.origConsole.info
			try {
				sink?.("[" + source + "] " + e.msg + (e.data ? " " + e.data : ""))
			} catch {
				/* echo is best-effort; never let it break logging */
			}
		}
		for (const fn of this.subs) {
			try {
				fn(e)
			} catch {
				/* a bad subscriber must never break logging */
			}
		}
		return e
	}

	debug(source: LogSource, msg: string, data?: unknown) {
		return this.push("debug", source, msg, data)
	}
	info(source: LogSource, msg: string, data?: unknown) {
		return this.push("info", source, msg, data)
	}
	warn(source: LogSource, msg: string, data?: unknown) {
		return this.push("warn", source, msg, data)
	}
	error(source: LogSource, msg: string, data?: unknown) {
		return this.push("error", source, msg, data)
	}

	/** Live subscription. Returns an unsubscribe function. */
	subscribe(fn: (e: LogEntry) => void): () => void {
		this.subs.add(fn)
		return () => this.subs.delete(fn)
	}

	/** Query the buffer. Returns oldest-to-newest, capped by `limit` (keeps the newest). */
	get(filter: LogFilter = {}): LogEntry[] {
		const min = filter.level ? LEVEL_ORDER[filter.level] : 0
		const needle = filter.contains ? filter.contains.toLowerCase() : null
		let out = this.buf.filter(
			(e) =>
				LEVEL_ORDER[e.level] >= min &&
				(!filter.source || e.source === filter.source) &&
				(!filter.since || e.t >= filter.since) &&
				(!needle || (e.msg + " " + (e.data ?? "")).toLowerCase().includes(needle))
		)
		const limit = filter.limit ?? 100
		if (out.length > limit) out = out.slice(out.length - limit)
		return out
	}

	all(): LogEntry[] {
		return this.buf.slice()
	}
	size(): number {
		return this.buf.length
	}
	clear(): void {
		this.buf = []
	}

	/** Full buffer as plain text, for the "record / download logs" button. */
	dumpText(): string {
		return this.buf
			.map(
				(e) =>
					new Date(e.t).toISOString() +
					" [" +
					e.level.toUpperCase().padEnd(5) +
					"] " +
					e.source +
					": " +
					e.msg +
					(e.data ? " | " + e.data : "")
			)
			.join("\n")
	}

	/** Patch console, error handlers, and fetch. Idempotent; safe to call once at boot. */
	install(): void {
		if (this.installed || typeof window === "undefined") return
		this.installed = true

		// console.* -> bus (keeps original behaviour)
		const con = window.console as unknown as Record<string, (...a: unknown[]) => void>
		const map: Record<string, LogLevel> = { log: "info", info: "info", warn: "warn", error: "error", debug: "debug" }
		for (const name of Object.keys(map)) {
			const orig = typeof con[name] === "function" ? con[name].bind(con) : undefined
			// Keep an UNPATCHED reference per level so push() can echo structured events without re-entering
			// the patched console (which would loop). Last writer per level wins; log/info collapse to info.
			if (orig) this.origConsole[map[name]] = orig
			con[name] = (...args: unknown[]) => {
				try {
					this.push(map[name], "console", args.map(asString).join(" "))
				} catch {
					/* ignore */
				}
				orig?.(...args)
			}
		}

		// uncaught errors + promise rejections
		window.addEventListener("error", (ev) => {
			const message = ev.message || "uncaught error"
			// "ResizeObserver loop completed with undelivered notifications" is a benign, extremely common
			// browser notice, not a real error. Downgrade it to debug so it doesn't spam the error badge.
			const benign = /ResizeObserver loop/i.test(message)
			this.push(benign ? "debug" : "error", benign ? "console" : "error", message, {
				filename: (ev as ErrorEvent).filename,
				lineno: (ev as ErrorEvent).lineno,
				stack: (ev as ErrorEvent).error?.stack,
			})
		})
		window.addEventListener("unhandledrejection", (ev) => {
			const r = (ev as PromiseRejectionEvent).reason
			this.push("error", "error", "unhandledrejection: " + (r?.message ?? asString(r)), r?.stack)
		})

		// fetch -> log method, url, status, timing (never headers or bodies)
		const of = window.fetch ? window.fetch.bind(window) : undefined
		if (of) {
			window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
				const req = input as Request
				const method = (init?.method || (typeof input === "object" && "method" in req ? req.method : "GET") || "GET").toUpperCase()
				const url = typeof input === "string" ? input : input instanceof URL ? input.href : req.url
				const start = typeof performance !== "undefined" ? performance.now() : Date.now()
				const ms = () => Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - start)
				try {
					const res = await of(input as RequestInfo, init)
					this.push(res.ok ? "debug" : "warn", "network", method + " " + url + " -> " + res.status, { ms: ms() })
					return res
				} catch (err) {
					this.push("error", "network", method + " " + url + " FAILED: " + (err instanceof Error ? err.message : String(err)), { ms: ms() })
					throw err
				}
			}
		}

		this.push("info", "system", "log bus installed")
	}
}

export const logBus = new LogBus()
