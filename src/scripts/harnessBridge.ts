import { circuitAPI } from "./circuitAPI"

/**
 * WebSocket harness bridge. When the editor is opened with `?harness=<port|ws-url>` it connects to a
 * local harness server (e.g. the MCP server in scripts/mcp-server.mjs) and lets that server drive the
 * circuit through {@link circuitAPI}. It is inert unless that query param is present, so it never runs
 * in normal use.
 *
 * Protocol (JSON over WebSocket):
 *   server -> editor : { id, method, args }
 *   editor -> server : { id, ok: true, result }  |  { id, ok: false, error }
 *   on connect the editor announces { type: "ready", methods: [...] }.
 */

type BridgeArgs = {
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

export function initHarnessBridge(): void {
	const url = bridgeUrl()
	if (!url) return

	const connect = () => {
		let ws: WebSocket
		try {
			ws = new WebSocket(url)
		} catch {
			setTimeout(connect, 2000)
			return
		}
		ws.addEventListener("open", () =>
			ws.send(JSON.stringify({ type: "ready", methods: Object.keys(DISPATCH) }))
		)
		ws.addEventListener("message", (ev) => {
			let req: { id?: unknown; method?: string; args?: BridgeArgs }
			try {
				req = JSON.parse(typeof ev.data === "string" ? ev.data : "{}")
			} catch {
				return
			}
			if (!req || typeof req.method !== "string") return
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
			ws.send(JSON.stringify(reply))
		})
		ws.addEventListener("close", () => setTimeout(connect, 2000))
		ws.addEventListener("error", () => ws.close())
	}
	connect()
}
