import { circuitAPI } from "./circuitAPI"
import { logBus } from "./logBus"

/**
 * WebSocket harness bridge. When the editor is opened with `?harness=<port|ws-url>` it connects to a
 * local harness server (e.g. the MCP server in scripts/mcp-server.mjs) and lets that server drive the
 * circuit through {@link circuitAPI}. It is inert unless that query param is present, so it never runs
 * in normal use.
 *
 * Protocol (JSON over WebSocket):
 *   server -> editor : { id, method, auth?, args }
 *   editor -> server : { id, ok: true, result }  |  { id, ok: false, error }
 *   on connect the editor announces { type: "ready", methods: [...] }.
 *
 * Security note: This bridge is only active when the `?harness=` query parameter is present,
 * which is intended for local development/testing. For production use, ensure the harness URL
 * is not exposed externally or add authentication at the WebSocket server level.
 */

// Authentication token (can be set via ?auth=<token> in URL)
const AUTH_TOKEN = new URLSearchParams(location.search).get("harness-auth")

type BridgeArgs = {
	auth?: string  // Added for auth validation
	text?: string
	index?: number
	x?: number
	y?: number
	angleDeg?: number
	horizontalAxis?: boolean
	level?: string
	source?: string
	contains?: string
	limit?: number
	// primitives
	type?: string
	rotationDeg?: number
	lengthCm?: number
	endX?: number
	endY?: number
	label?: string
	from?: string
	to?: string
	route?: "auto" | "direct" | "hv" | "vh"
	anchor?: string
	dx?: number
	dy?: number
	filter?: string
	names?: string[]
	name?: string
	expect?: { components?: number; nets?: number; maxDangling?: number; connected?: [string, string][] }
}

const DISPATCH: Record<string, (args: BridgeArgs) => unknown> = {
	// read
	list_components: () => circuitAPI.listComponents(),
	count: () => circuitAPI.count(),
	get_component: (a) => circuitAPI.getComponent(Number(a?.index)),
	describe_canvas: () => circuitAPI.describeCanvas(),
	get_logs: (a) => circuitAPI.getLogs(a || {}),
	export_tikz: () => circuitAPI.exportTikz(),
	export_json: () => circuitAPI.exportJson(),
	list_symbols: (a) => circuitAPI.listSymbols(a?.filter),
	resolve_components: (a) => circuitAPI.resolveComponents(a?.names || []),
	lookup_pattern: (a) => circuitAPI.lookupPattern(a?.name),
	verify_circuit: (a) => circuitAPI.verifyCircuit(a?.expect ?? {}),
	// write
	import_tikz: (a) => circuitAPI.importTikz(String(a?.text ?? "")),
	add_component: (a) =>
		circuitAPI.addComponent(String(a?.type ?? ""), Number(a?.x), Number(a?.y), {
			rotationDeg: a?.rotationDeg,
			lengthCm: a?.lengthCm,
			endX: a?.endX,
			endY: a?.endY,
			label: a?.label,
		}),
	connect: (a) => circuitAPI.connect(String(a?.from ?? ""), String(a?.to ?? ""), a?.route ?? "auto"),
	place_relative: (a) =>
		circuitAPI.placeRelative(String(a?.type ?? ""), String(a?.anchor ?? ""), Number(a?.dx ?? 0), Number(a?.dy ?? 0), {
			rotationDeg: a?.rotationDeg,
			lengthCm: a?.lengthCm,
			endX: a?.endX,
			endY: a?.endY,
			label: a?.label,
		}),
	move_component: (a) => circuitAPI.moveComponent(Number(a?.index), Number(a?.x), Number(a?.y)),
	rotate_component: (a) => circuitAPI.rotateComponent(Number(a?.index), Number(a?.angleDeg)),
	flip_component: (a) => circuitAPI.flipComponent(Number(a?.index), a?.horizontalAxis ?? true),
	delete_component: (a) => circuitAPI.deleteComponent(Number(a?.index)),
	clear: () => circuitAPI.clear(),
}

function bridgeUrl(): string | null {
	const v = new URLSearchParams(location.search).get("harness")
	if (!v) return null
	return /^wss?:\/\//.test(v) ? v : "ws://localhost:" + v
}

/**
 * Validate authentication token if required.
 */
function validateAuth(args: BridgeArgs | undefined): boolean {
	// If no auth token configured, allow all requests (development mode)
	if (!AUTH_TOKEN) return true

	const provided = args?.auth
	if (!provided) return false

	return provided === AUTH_TOKEN
}

export function initHarnessBridge(): void {
	const url = bridgeUrl()
	if (!url) return

	const connect = () => {
		let ws: WebSocket
		try {
			ws = new WebSocket(url)
		} catch (e) {
			// The fetch patch in logBus does NOT cover WebSocket, so the harness channel is invisible
			// unless we log it explicitly here. Surface every connect attempt, message and error.
			logBus.warn("network", "harness: WebSocket construction failed, retrying in 2s: " + (e instanceof Error ? e.message : String(e)))
			setTimeout(connect, 2000)
			return
		}
		ws.addEventListener("open", () => {
			logBus.info("network", "harness: connected to " + url)
			ws.send(JSON.stringify({ type: "ready", methods: Object.keys(DISPATCH) }))
		})
		ws.addEventListener("message", (ev) => {
			let req: { id?: unknown; method?: string; auth?: string; args?: BridgeArgs }
			try {
				req = JSON.parse(typeof ev.data === "string" ? ev.data : "{}")
			} catch {
				logBus.warn("network", "harness: dropped an unparseable message")
				return
			}
			if (!req || typeof req.method !== "string") {
				logBus.warn("tool", "harness: message without a method field", req)
				return
			}

			// Auth validation for write operations (import_tikz, add_component, clear, etc.)
			const isWriteOp = !["list_components", "count", "describe_canvas", "get_logs", "export_tikz", "export_json", "list_symbols", "resolve_components", "lookup_pattern", "verify_circuit"].includes(req.method)
			if (isWriteOp && !validateAuth(req)) {
				logBus.warn("tool", "harness: unauthorized write rejected: " + req.method)
				const reply = { id: req.id, ok: false, error: "unauthorized: authentication required for write operations" }
				ws.send(JSON.stringify(reply))
				return
			}

			let reply: Record<string, unknown>
			try {
				const fn = DISPATCH[req.method]
				reply =
					fn ?
						{ id: req.id, ok: true, result: fn(req.args || {}) }
					:	{ id: req.id, ok: false, error: "unknown method: " + req.method }
			} catch (e) {
				reply = { id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) }
			}
			const ok = reply.ok === true
			logBus[ok ? "info" : "warn"]("tool", "harness " + req.method + (ok ? "" : " FAILED"), ok ? req.args : reply.error)
			ws.send(JSON.stringify(reply))
		})
		ws.addEventListener("close", () => {
			logBus.warn("network", "harness: connection closed, reconnecting in 2s")
			setTimeout(connect, 2000)
		})
		ws.addEventListener("error", () => {
			logBus.error("network", "harness: WebSocket error on " + url)
			ws.close()
		})
	}
	connect()
}
