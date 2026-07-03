#!/usr/bin/env node
// CircuiTikZ-Designer MCP server.
//
// Exposes the editor's circuitAPI as Model Context Protocol tools so external agents can inspect and
// edit circuits. It bridges to the running editor over a WebSocket: start this server, then open the
// app with `?harness=<port>` (default 7077) so the editor connects back.
//
//   node scripts/mcp-server.mjs            # ws bridge on :7077, MCP on stdio
//   HARNESS_PORT=9000 node scripts/mcp-server.mjs
//
// Architecture:  agent --MCP/stdio--> this server --WebSocket--> editor (circuitAPI)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { WebSocketServer } from "ws"

const WS_PORT = process.env.HARNESS_PORT ? Number(process.env.HARNESS_PORT) : 7077

// ---- WebSocket bridge to the editor ---------------------------------------------------------
const wss = new WebSocketServer({ port: WS_PORT })
let editor = null
const pending = new Map()
let nextId = 1

wss.on("connection", (ws) => {
	editor = ws
	ws.on("message", (data) => {
		let msg
		try {
			msg = JSON.parse(data.toString())
		} catch {
			return
		}
		if (msg.type === "ready") return // editor handshake
		const resolve = pending.get(msg.id)
		if (resolve) {
			pending.delete(msg.id)
			resolve(msg)
		}
	})
	ws.on("close", () => {
		if (editor === ws) editor = null
	})
})

function callEditor(method, args) {
	return new Promise((resolve, reject) => {
		if (!editor || editor.readyState !== 1) {
			reject(new Error(`No editor connected. Open the app with ?harness=${WS_PORT}`))
			return
		}
		const id = nextId++
		pending.set(id, (msg) => (msg.ok ? resolve(msg.result) : reject(new Error(msg.error || "tool failed"))))
		editor.send(JSON.stringify({ id, method, args }))
		setTimeout(() => {
			if (pending.has(id)) {
				pending.delete(id)
				reject(new Error("Editor did not respond in time."))
			}
		}, 15000)
	})
}

const asText = (v) => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] })

// ---- MCP server -----------------------------------------------------------------------------
const server = new McpServer({ name: "circuitikz-designer", version: "1.0.0" })

server.registerTool(
	"list_components",
	{ description: "List the components currently on the canvas (type, name, position) in cm, Y-up - the TikZ frame.", inputSchema: {} },
	async () => asText(await callEditor("list_components", {}))
)

server.registerTool(
	"export_tikz",
	{ description: "Export the current circuit as a CircuiTikZ source string.", inputSchema: {} },
	async () => asText(await callEditor("export_tikz", {}))
)

server.registerTool(
	"import_tikz",
	{
		description: "Add components to the canvas from a CircuiTikZ (or JSON) string, e.g. \\draw (0,0) to[R] (2,0);",
		inputSchema: { text: z.string().describe("CircuiTikZ source to place on the canvas") },
	},
	async ({ text }) => asText(await callEditor("import_tikz", { text }))
)

server.registerTool(
	"get_component",
	{
		description:
			"Inspect ONE component in full, all in cm/Y-up (TikZ frame): reference position, bounding box, named pins, rotation, name/label, its CircuiTikZ, and its serialized state. Use the index from list_components. Read-only.",
		inputSchema: { index: z.number().int().describe("0-based index from list_components") },
	},
	async ({ index }) => asText(await callEditor("get_component", { index }))
)

server.registerTool(
	"export_json",
	{ description: "Export the whole circuit as the editor's native JSON save objects (one per component). Read-only.", inputSchema: {} },
	async () => asText(await callEditor("export_json", {}))
)

server.registerTool(
	"describe_canvas",
	{
		description:
			"Read-only. THE verification report, all in cm/Y-up (TikZ frame): every component with type/name/label/rotation/position/size/named pins, plus nets (pins electrically joined, wires traced), dangling (terminals on nothing), overlaps (colliding parts), nearMisses (pins <0.2cm apart but NOT connected = probable mistakes). Call before wiring and after building.",
		inputSchema: {},
	},
	async () => asText(await callEditor("describe_canvas", {}))
)

server.registerTool(
	"list_symbols",
	{
		description:
			"Read-only. The catalog of placeable component types (tikz ids, aliases like R/C/L/V, kind path|node). With a filter: full detail incl. footprint size in cm and named pins. kind 'path' = bipole between two points; 'node' = sits at one point.",
		inputSchema: { filter: z.string().optional().describe("substring to search the catalog") },
	},
	async (args) => asText(await callEditor("list_symbols", args ?? {}))
)

server.registerTool(
	"add_component",
	{
		description:
			"PREFERRED way to place ONE component (no hand-written TikZ). type = tikz id or alias (see list_symbols). Bipoles: (x,y) is the START terminal; give endX/endY or rotationDeg (direction, 0=+x, CCW) + lengthCm (default 2). Nodes: (x,y) is the reference, rotationDeg rotates. Returns the new index + live pin coordinates in cm.",
		inputSchema: {
			type: z.string().describe("tikz id or alias from list_symbols"),
			x: z.number().describe("x in cm (bipole: start terminal)"),
			y: z.number().describe("y in cm, Y-up (bipole: start terminal)"),
			rotationDeg: z.number().optional().describe("bipole: span direction; node: rotation. CCW, default 0"),
			lengthCm: z.number().optional().describe("bipole span length in cm, default 2"),
			endX: z.number().optional().describe("bipole: explicit end x (overrides rotation/length)"),
			endY: z.number().optional().describe("bipole: explicit end y (overrides rotation/length)"),
			label: z.string().optional().describe("label text (bipoles only)"),
		},
	},
	async (args) => asText(await callEditor("add_component", args ?? {}))
)

server.registerTool(
	"connect",
	{
		description:
			"PREFERRED way to wire two points: the harness routes the wire. from/to are pin refs like '3.START' / '0.G' (from describe_canvas / add_component) or cm coordinates like '(2, 1.5)'. route: auto (default), hv, vh, or direct.",
		inputSchema: {
			from: z.string().describe("pin ref '3.START' / '0.G' or coordinate '(2, 1.5)'"),
			to: z.string().describe("pin ref or coordinate"),
			route: z.enum(["auto", "direct", "hv", "vh"]).optional().describe("wire routing, default auto"),
		},
	},
	async (args) => asText(await callEditor("connect", args ?? {}))
)

server.registerTool(
	"place_relative",
	{
		description:
			"add_component positioned relative to an existing pin: anchor is a pin ref like '2.END' (or a coordinate), dx/dy are offsets in cm. Same options and return shape as add_component.",
		inputSchema: {
			type: z.string().describe("tikz id or alias from list_symbols"),
			anchor: z.string().describe("pin ref '2.END' / '0.D' or coordinate '(2, 1.5)'"),
			dx: z.number().describe("x offset from the anchor in cm"),
			dy: z.number().describe("y offset from the anchor in cm (Y-up)"),
			rotationDeg: z.number().optional().describe("see add_component"),
			lengthCm: z.number().optional().describe("see add_component"),
			endX: z.number().optional().describe("see add_component"),
			endY: z.number().optional().describe("see add_component"),
			label: z.string().optional().describe("see add_component"),
		},
	},
	async (args) => asText(await callEditor("place_relative", args ?? {}))
)

server.registerTool(
	"verify_circuit",
	{
		description:
			"THE final check - the harness computes pass/fail. Checks overlaps, near-misses, recent errors, and explicit expectations: expected component count, expected net count, max allowed dangling terminals, pin pairs that must be connected. Returns {pass, summary, problems?}.",
		inputSchema: {
			expect: z
				.object({
					components: z.number().int().optional().describe("expected total component count"),
					nets: z.number().int().optional().describe("expected number of nets"),
					maxDangling: z.number().int().optional().describe("max acceptable dangling terminals"),
					connected: z
						.array(z.tuple([z.string(), z.string()]))
						.optional()
						.describe("pin-ref pairs that must share a net"),
				})
				.optional()
				.describe("expectations to check against"),
		},
	},
	async (args) => asText(await callEditor("verify_circuit", args ?? {}))
)

server.registerTool(
	"get_logs",
	{
		description:
			"Read-only. Recent app logs (console, network, errors, tool calls, circuit edits) so you can see what actually happened and self-diagnose. Filter by level, source, a 'contains' substring, and limit.",
		inputSchema: {
			level: z.enum(["debug", "info", "warn", "error"]).optional().describe("minimum level"),
			source: z.string().optional().describe("console|network|error|tool|circuit|system"),
			contains: z.string().optional().describe("only entries containing this text"),
			limit: z.number().int().optional().describe("max entries (default 50)"),
		},
	},
	async (args) => asText(await callEditor("get_logs", args ?? {}))
)

server.registerTool(
	"move_component",
	{
		description: "Move a component's reference point to (x, y) in cm, Y-up - the exact same numbers you would write in TikZ. Use list_components/get_component first to pick the index.",
		inputSchema: {
			index: z.number().int().describe("0-based index from list_components"),
			x: z.number().describe("target x in cm (TikZ frame)"),
			y: z.number().describe("target y in cm, Y-up (TikZ frame)"),
		},
	},
	async ({ index, x, y }) => asText(await callEditor("move_component", { index, x, y }))
)

server.registerTool(
	"rotate_component",
	{
		description: "Rotate a component by angleDeg degrees (positive = counter-clockwise).",
		inputSchema: {
			index: z.number().int().describe("0-based index from list_components"),
			angleDeg: z.number().describe("rotation in degrees, e.g. 90, -90, 180"),
		},
	},
	async ({ index, angleDeg }) => asText(await callEditor("rotate_component", { index, angleDeg }))
)

server.registerTool(
	"flip_component",
	{
		description: "Mirror a component. horizontalAxis=true flips across the horizontal axis, false across the vertical.",
		inputSchema: {
			index: z.number().int().describe("0-based index from list_components"),
			horizontalAxis: z.boolean().optional().describe("true = mirror across horizontal axis (default true)"),
		},
	},
	async ({ index, horizontalAxis }) => asText(await callEditor("flip_component", { index, horizontalAxis }))
)

server.registerTool(
	"delete_component",
	{
		description: "Delete ONE component by index (from list_components). To wipe the whole canvas use clear instead.",
		inputSchema: { index: z.number().int().describe("0-based index from list_components") },
	},
	async ({ index }) => asText(await callEditor("delete_component", { index }))
)

server.registerTool(
	"clear",
	{ description: "Remove ALL components from the canvas (destructive). Only use to reset/start over; to remove one component use delete_component.", inputSchema: {} },
	async () => asText(await callEditor("clear", {}))
)

const transport = new StdioServerTransport()
await server.connect(transport)
process.stderr.write(`CircuiTikZ MCP server ready - WebSocket bridge on :${WS_PORT}, MCP on stdio.\n`)
