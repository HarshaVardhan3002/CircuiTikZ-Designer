import { circuitAPI } from "./circuitAPI"
import { logBus } from "./logBus"
import { captureCanvasPng } from "./canvasCapture"
import { getActiveProviderId, loadProviderConfig } from "./vision/storage/providerStorage"

/**
 * In-app AI chat that can act on the circuit through the harness ({@link circuitAPI}).
 *
 * It speaks the OpenAI tool-calling dialect and reuses the AI provider the user already configured
 * for the vision feature (Settings -> AI Provider). The model is given a small set of tools that map
 * 1:1 onto circuitAPI, so the assistant can inspect and edit the live circuit while chatting.
 */

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } }
/** OpenAI-style multimodal content part (used for the canvas-screenshot visual-check turn). */
type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
type ChatMessage = {
	role: "system" | "user" | "assistant" | "tool"
	content?: string | ContentPart[] | null
	tool_calls?: ToolCall[]
	tool_call_id?: string
}

/** Flatten message content (string or multimodal parts) to plain text for display/transcripts. */
function contentText(content: ChatMessage["content"]): string {
	if (typeof content === "string") return content
	if (Array.isArray(content)) return content.map((p) => (p.type === "text" ? p.text : "[image]")).join(" ")
	return ""
}

const SYSTEM_PROMPT = [
	"You are the Beta AI assistant built into CircuiTikZ-Designer, a visual editor that renders circuits as CircuiTikZ/LaTeX.",
	"You help the user inspect, build, and edit the circuit on their canvas by calling tools, and you answer questions about circuits and the editor.",
	"",
	"=== GOLDEN RULE: ACT ONLY ON EXPLICIT REQUESTS ===",
	"Call a tool ONLY when the user's latest message clearly asks you to inspect, draw, add, change, or clear something on the canvas.",
	"If the message is a greeting, thanks, small talk, an open question, or anything ambiguous, reply in plain text and DO NOT call any tool.",
	"Never place, modify, or delete components unless the user actually asked for it. An empty 'Hi' must NEVER create components.",
	"Examples:",
	"- 'hi' / 'hello' / 'you there?'  -> greet back in one short line. NO tool calls.",
	"- 'what can you do?'             -> explain briefly in text. NO tool calls.",
	"- 'thanks' / 'cool'             -> acknowledge briefly. NO tool calls.",
	"- 'draw an RC low-pass filter'   -> explicit build request: follow the methodology below.",
	"- 'what is on the canvas?'       -> explicit read request: call list_components, then summarize.",
	"When in doubt, ask ONE short clarifying question instead of guessing. A wrong edit is worse than a question.",
	"",
	"=== COORDINATE FRAME (one language everywhere) ===",
	"Every tool speaks TikZ coordinates: centimetres, Y pointing UP, origin (0,0). What you write in import_tikz, what you read from list_components/get_component/describe_canvas, and what you pass to move_component are all THE SAME frame. A part placed at (2,1) reads back at (2,1) and moves with move_component(i,2,1).",
	"Pin references look like '3.START' or '0.G' = <componentIndex>.<pinName>. Components CONNECT when pin coordinates match EXACTLY - near is not connected (describe_canvas reports such almost-touching pins as nearMisses).",
	"",
	"=== METHODOLOGY (follow in order for ANY canvas action) ===",
	"1. READ FIRST: before editing, call list_components (and describe_canvas when connecting to existing parts). Never assume the canvas is empty.",
	"2. PLAN: choose the components and a tidy grid layout (coordinates in cm, nodes >= 2 cm apart).",
	"3. BUILD WITH PRIMITIVES (preferred): add_component / place_relative to place parts one at a time, connect to wire pins together by reference. You get each part's live pin coordinates back - use them. Hand-written import_tikz is the ESCAPE HATCH for bulk paste or exotic syntax, not the default.",
	"4. WATCH autoCheck: every write returns an autoCheck {pass, summary, problems?}. If pass is false, STOP and fix the reported problems before placing anything else. Fix, don't pile on.",
	"5. VERIFY: when the build is done, call verify_circuit with your expectations (e.g. connected pairs, maxDangling for intended open ports). At most 3 repair rounds; if it still fails, report the remaining problems honestly.",
	"6. REPORT: in one or two sentences say what you placed or changed and the verify result. Do not paste large TikZ dumps unless asked.",
	"Do not ask for confirmation before a clearly-requested edit; just run steps 1-6. Only ask when the request itself is ambiguous.",
	"",
	"=== EDITING DISCIPLINE (critical, this is where agents go wrong) ===",
	"- To change an existing circuit, EDIT it: move_component / rotate_component / flip_component / delete_component, or import_tikz to add more. NEVER call clear to 'start fresh' before rebuilding. clear is ONLY for an explicit user reset and will be REFUSED otherwise.",
	"- import_tikz is ADDITIVE: it appends to what is already on the canvas. Do NOT re-send the whole circuit to 'update' it, that duplicates every component. Add only the new parts.",
	"- Before adding or wiring anything that must connect to existing parts, call describe_canvas to read the REAL pin coordinates and the existing nets. Route wires and place new components so endpoints share EXACT coordinates with those pins.",
	"- Never guess where a component's pins are. Larger components (op-amps, transistors, sources, ICs) have pins AWAY from their reference point; only describe_canvas / get_component give you the true positions.",
	"",
	"=== TOOLS (this is the COMPLETE set of actions you can take) ===",
	"READ tools (safe anytime, they never change the canvas):",
	"- list_symbols({ filter? }) -> the catalog of placeable types (tikz ids, aliases like R/C/L/V, kind path|node; with filter also sizes and pin names). Check here before guessing a type name.",
	"- verify_circuit({ components?, nets?, maxDangling?, connected? }) -> harness-computed {pass, summary, problems}. THE way to check your work; you never declare success yourself.",
	"- list_components() -> [{ index, type, name?, x, y }, ...] in cm. Overview of everything on the canvas.",
	"- get_component({ index }) -> full detail of ONE component in cm: position, bbox, named pins, rotation, name/label, its CircuiTikZ, and serialized state. Use this to SEE a component before you move or edit it.",
	"- describe_canvas() -> THE verification report, all in cm: every component with type/name/label/rotation/position/SIZE/named pins, plus nets (which pins are electrically joined, wires traced), dangling (terminals connected to NOTHING), overlaps (parts whose boxes collide), nearMisses (pins closer than 0.2cm that are NOT connected = probable wiring mistakes). Call before wiring and after building.",
	"- export_tikz() -> the whole canvas as one CircuiTikZ string.",
	"- export_json() -> the whole canvas as the editor's native JSON save objects.",
	"- get_logs({ level?, source?, contains?, limit? }) -> recent app logs (console, network, errors, tool calls, circuit edits). Use to self-diagnose when a tool errored or the result looks wrong.",
	"WRITE tools (ONLY when the user explicitly asked to change the canvas; every write returns autoCheck):",
	"- add_component({ type, x, y, rotationDeg?, lengthCm?, endX?, endY?, label? }) -> place ONE part; returns its index + live pins. PREFERRED over hand-TikZ.",
	"- connect({ from, to, route? }) -> wire two pins/points by reference ('3.START', '0.G', or '(2,1.5)'); the harness routes the wire. PREFERRED for all wiring.",
	"- place_relative({ type, anchor, dx, dy, ... }) -> add_component positioned relative to an existing pin.",
	"- import_tikz({ text }) -> ADD components from CircuiTikZ (additive: it appends, it does not replace). ESCAPE HATCH for bulk/exotic input. Returns { ok, count }.",
	"- move_component({ index, x, y }) -> move a component's reference point to (x, y) in cm, Y-up - the same numbers you would write in TikZ.",
	"- rotate_component({ index, angleDeg }) -> rotate a component by degrees (positive = counter-clockwise).",
	"- flip_component({ index, horizontalAxis }) -> mirror a component (horizontalAxis defaults to true).",
	"- delete_component({ index }) -> remove ONE component. Use clear() only to wipe everything.",
	"- clear() -> remove ALL components. DESTRUCTIVE; only on an explicit reset/start-over request.",
	"Indexes always come from list_components. To EDIT an existing circuit: read first (list_components / get_component), then move/rotate/flip/delete or import_tikz. You are NOT limited to append-or-wipe anymore.",
	"",
	"=== CIRCUITIKZ SYNTAX (write exactly this dialect inside import_tikz text) ===",
	"A bare body of \\draw / \\node lines is fine; a full tikzpicture/circuitikz environment is also accepted.",
	"Coordinates are (x,y) in cm, e.g. (0,0), (2,0), (2,-2). Bipoles use the to[...] form between two coordinates:",
	"  \\draw (0,0) to[R=$R_1$] (2,0);     % resistor",
	"  \\draw (2,0) to[C=$C_1$] (2,-2);    % capacitor",
	"  \\draw (0,0) to[L=$L_1$] (2,0);     % inductor",
	"  \\draw (0,0) to[V=$V_1$] (0,2);     % voltage source",
	"  \\draw (0,0) to[I=$I_1$] (0,2);     % current source",
	"  \\draw (0,0) to[D] (2,0);           % diode",
	"  \\draw (0,0) to[switch] (2,0);      % switch",
	"  \\draw (0,0) to[battery1] (0,2);    % battery",
	"  \\draw (2,0) -- (4,0);              % plain wire (no component)",
	"  \\node[ground] at (0,-2){};         % ground symbol",
	"Standard bipole keys you may use: R, C, L, V, I, D, switch, battery1, short. Label a value with =$...$, e.g. to[R=$1\\,k\\Omega$].",
	"Chain coordinates so nodes line up. Example RC low-pass filter:",
	"  \\draw (0,0) to[V=$V_{in}$] (0,2); \\draw (0,2) to[R=$R$] (3,2); \\draw (3,2) to[C=$C$] (3,0); \\draw (0,0) -- (3,0);",
	"Do NOT invent non-standard component keys. If unsure, use the closest standard key (R, C, L, V, I, D, short) rather than guessing an exotic name.",
	"SPACING (important): a bipole symbol is ~1 cm long, so put nodes AT LEAST 2 cm apart or the components overlap into an unreadable mess. Use coordinates like 0,2,4,6… not 0,1,2,3. describe_canvas reports each part's real size and any overlaps - use it instead of guessing.",
	"GRIDS/MESHES: place nodes on a 2-unit lattice, e.g. an NxN mesh has nodes at (2i, -2j). Connect each node to its RIGHT neighbour and its neighbour BELOW only - that covers every four-neighbour link exactly once with no duplicates. Edge nodes simply have fewer links. Emit all edges in one import_tikz.",
	"",
	"=== ANTI-HALLUCINATION ===",
	"- Never claim you placed something without actually calling import_tikz.",
	"- Never fabricate tool results, component counts, or success when a tool returned an error.",
	"- Never add components, labels, or values the user did not ask for.",
	"- If you cannot express the request in standard CircuiTikZ, say so plainly instead of inventing syntax.",
	"",
	"=== VERIFICATION & HONESTY (never fake success) ===",
	"- After building or editing, VERIFY before you claim anything: call verify_circuit (with expectations: connected pairs, maxDangling for intended ports). The HARNESS computes pass/fail; report what it returned, never your own judgement.",
	"- NEVER say 'all connected', 'compiles without modification', or 'correct' unless verify_circuit passed THIS turn. If autoCheck or verify_circuit report problems, say so plainly and fix them (a nearMiss usually means moving one endpoint by the reported gap). Max 3 repair rounds, then report the residual problems honestly. An honest 'I placed X, but Y is dangling' beats a confident false 'done'.",
	"- Large/complex schematics (multi-bit adders, ALUs, CPUs, anything with hundreds of gates) are NOT reliably built in one shot. Build and verify ONE small block first, then replicate. Do not emit hundreds of components at once and assert correctness.",
	"- CircuiTikZ targets analog/electronic schematics and modest logic; it is a poor fit for large digital datapaths. If a request is beyond what you can build correctly, say so and propose the smaller-block approach instead of producing a plausible-looking but wrong result.",
	"Keep every reply short and concrete.",
].join("\n")

/** Short reminder re-sent every round so a long tool loop cannot forget the contract (anti-drift). */
const DRIFT_REMINDER =
	"Reminder: act only on the user's explicit request. All coordinates are cm, Y-up (TikZ frame) on every tool. Prefer add_component/connect/place_relative over hand-TikZ; never clear-to-rebuild. If a write's autoCheck says pass=false, fix those problems before anything else. Finish with verify_circuit and report ITS verdict (max 3 repair rounds). Do not repeat a tool call that already succeeded."

/** True if the user's message actually asks to wipe/reset the canvas (gates the destructive clear tool). */
function isResetIntent(text: string): boolean {
	return /\b(clear|reset|start over|start fresh|wipe|scrap|empty|delete (everything|all|the canvas)|remove (everything|all)|blank canvas|from scratch)\b/i.test(
		text || ""
	)
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
/** Exponential backoff for the harness-initiated auto-retry (D2): 400ms, 800ms, 1600ms, capped at 4s. */
const backoffMs = (attempt: number) => Math.min(4000, 400 * 2 ** (attempt - 1))

const GREETING =
	"Hi! I am the Beta AI assistant. I can inspect and edit your circuit. Try: “draw an RC low-pass filter”. (Set your AI Beta provider in Settings first.)"

/** A saved chat session (the "chat logs" history), persisted in localStorage. */
type StoredChat = { id: string; title: string; ts: number; messages: ChatMessage[] }
const HISTORY_KEY = "ctkChatHistory"
function safeParse(s: string | undefined): unknown {
	try {
		return JSON.parse(s || "{}")
	} catch {
		return {}
	}
}

const TOOLS = [
	{
		type: "function",
		function: {
			name: "list_components",
			description: "Read-only. List the components on the canvas as [{index,type,name?,x,y}] in cm, Y-up (TikZ frame). Call before editing an existing circuit, or whenever the user asks what is on the canvas. Safe to call anytime.",
			parameters: { type: "object", properties: {}, additionalProperties: false },
		},
	},
	{
		type: "function",
		function: {
			name: "export_tikz",
			description: "Read-only. Return the entire canvas as one CircuiTikZ source string. Use when you need the exact current source to modify or extend it, or when the user asks for the code.",
			parameters: { type: "object", properties: {}, additionalProperties: false },
		},
	},
	{
		type: "function",
		function: {
			name: "import_tikz",
			description: "ADD components to the canvas from CircuiTikZ source. ADDITIVE: it appends, it does not replace (call clear first to replace). Returns {ok,count} with the new total. Call ONLY when the user explicitly asked to add/draw/build/insert a component or circuit; NEVER for greetings, acknowledgements, or questions. Provide valid CircuiTikZ in 'text', e.g. \\draw (0,0) to[R=$R_1$] (2,0);",
			parameters: {
				type: "object",
				properties: { text: { type: "string", description: "CircuiTikZ source, e.g. \\draw (0,0) to[R] (2,0);" } },
				required: ["text"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "clear",
			description: "Remove ALL components from the canvas. DESTRUCTIVE. Call ONLY when the user explicitly asks to clear/reset/start over. To change part of a circuit, edit instead of clearing.",
			parameters: { type: "object", properties: {}, additionalProperties: false },
		},
	},
	{
		type: "function",
		function: {
			name: "get_component",
			description:
				"Read-only. Inspect ONE component in full, all in cm/Y-up (TikZ frame): position, bounding box, named pins, rotation, name/label, its CircuiTikZ, and serialized state. Use an index from list_components. Call this to SEE a component before editing it.",
			parameters: {
				type: "object",
				properties: { index: { type: "integer", description: "0-based index from list_components" } },
				required: ["index"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "export_json",
			description: "Read-only. Return the whole circuit as the editor's native JSON save objects (one per component).",
			parameters: { type: "object", properties: {}, additionalProperties: false },
		},
	},
	{
		type: "function",
		function: {
			name: "describe_canvas",
			description:
				"Read-only. THE verification report, all in cm/Y-up (TikZ frame): every component with type/name/label/rotation/position/size/named pins, plus nets (pins electrically joined, wires traced), dangling (terminals on nothing), overlaps (colliding parts), nearMisses (pins <0.2cm apart but NOT connected = probable mistakes). Call before wiring and after building to verify instead of claiming.",
			parameters: { type: "object", properties: {}, additionalProperties: false },
		},
	},
	{
		type: "function",
		function: {
			name: "list_symbols",
			description:
				"Read-only. The catalog of placeable component types. Without filter: compact list (tikz id, display name, kind, aliases). With filter (substring of id/name/group/alias, e.g. 'resistor' or 'transistor'): full detail incl. footprint size in cm and named pins. kind 'path' = bipole between two points; kind 'node' = sits at one point.",
			parameters: {
				type: "object",
				properties: { filter: { type: "string", description: "optional substring to search the catalog" } },
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "add_component",
			description:
				"PREFERRED way to place ONE component (no hand-written TikZ). type = tikz id or alias (R, C, L, V, I, D, nmos, ground, ...; see list_symbols). For bipoles (kind 'path'): (x,y) is the START terminal; either give endX/endY or rotationDeg (direction, 0=+x, CCW) + lengthCm (default 2). For node symbols: (x,y) is the reference point, rotationDeg rotates. Returns the new index + live pin coordinates so you can connect immediately. Result includes autoCheck.",
			parameters: {
				type: "object",
				properties: {
					type: { type: "string", description: "tikz id or alias from list_symbols" },
					x: { type: "number", description: "x in cm (bipole: start terminal)" },
					y: { type: "number", description: "y in cm, Y-up (bipole: start terminal)" },
					rotationDeg: { type: "number", description: "bipole: direction of the span; node: symbol rotation. CCW, default 0" },
					lengthCm: { type: "number", description: "bipole span length in cm, default 2" },
					endX: { type: "number", description: "bipole: explicit end terminal x (overrides rotation/length)" },
					endY: { type: "number", description: "bipole: explicit end terminal y (overrides rotation/length)" },
					label: { type: "string", description: "label text, e.g. R_1 or 10k\\Omega (bipoles only)" },
				},
				required: ["type", "x", "y"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "connect",
			description:
				"PREFERRED way to wire two points: the harness routes the wire, you never compute wire coordinates. from/to are pin refs like '3.START' or '0.G' (from describe_canvas / add_component results) or bare cm coordinates like '(2, 1.5)'. route: auto (default; straight when aligned, else horizontal-then-vertical L), hv, vh, or direct. Result includes autoCheck.",
			parameters: {
				type: "object",
				properties: {
					from: { type: "string", description: "pin ref '3.START' / '0.G' or coordinate '(2, 1.5)'" },
					to: { type: "string", description: "pin ref or coordinate" },
					route: { type: "string", enum: ["auto", "direct", "hv", "vh"], description: "wire routing, default auto" },
				},
				required: ["from", "to"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "place_relative",
			description:
				"add_component, but positioned relative to an existing pin: anchor is a pin ref like '2.END' (or a coordinate), dx/dy are offsets in cm. Grow circuits without recomputing absolute coordinates. Same options and return shape as add_component (incl. autoCheck).",
			parameters: {
				type: "object",
				properties: {
					type: { type: "string", description: "tikz id or alias from list_symbols" },
					anchor: { type: "string", description: "pin ref '2.END' / '0.D' or coordinate '(2, 1.5)'" },
					dx: { type: "number", description: "x offset from the anchor in cm" },
					dy: { type: "number", description: "y offset from the anchor in cm (Y-up)" },
					rotationDeg: { type: "number", description: "see add_component" },
					lengthCm: { type: "number", description: "see add_component" },
					endX: { type: "number", description: "see add_component" },
					endY: { type: "number", description: "see add_component" },
					label: { type: "string", description: "see add_component" },
				},
				required: ["type", "anchor", "dx", "dy"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "verify_circuit",
			description:
				"THE final check - the harness computes pass/fail, you never self-certify. Checks overlaps, near-misses, recent runtime errors, and your explicit expectations: expected component count, expected net count, max allowed dangling terminals, and pin pairs that MUST be connected (e.g. [['0.t1','2.START']]). Returns {pass, summary, problems?}. Call after building; if pass=false, repair and re-verify (max 3 repair rounds, then report honestly).",
			parameters: {
				type: "object",
				properties: {
					components: { type: "integer", description: "expected total component count" },
					nets: { type: "integer", description: "expected number of nets" },
					maxDangling: { type: "integer", description: "max acceptable dangling terminals (open ports)" },
					connected: {
						type: "array",
						items: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 },
						description: "pin-ref pairs that must share a net, e.g. [[\"0.t1\",\"2.START\"]]",
					},
				},
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "get_logs",
			description:
				"Read-only. Read recent app logs (console, network, errors, tool calls, circuit edits) to see what actually happened and self-diagnose when something looks wrong. Filter by level, source, a 'contains' substring, and limit.",
			parameters: {
				type: "object",
				properties: {
					level: { type: "string", enum: ["debug", "info", "warn", "error"], description: "minimum level to include" },
					source: { type: "string", description: "one of: console, network, error, tool, circuit, system" },
					contains: { type: "string", description: "only entries whose text contains this" },
					limit: { type: "integer", description: "max entries to return (default 50)" },
				},
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "move_component",
			description: "Move a component's reference point to (x,y) in cm, Y-up - the exact same numbers you would write in TikZ. Read the canvas first (list_components/get_component) to pick the index.",
			parameters: {
				type: "object",
				properties: {
					index: { type: "integer", description: "0-based index from list_components" },
					x: { type: "number", description: "target x in cm (TikZ frame)" },
					y: { type: "number", description: "target y in cm, Y-up (TikZ frame)" },
				},
				required: ["index", "x", "y"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "rotate_component",
			description: "Rotate a component by angleDeg degrees (positive = counter-clockwise), e.g. 90, -90, 180.",
			parameters: {
				type: "object",
				properties: {
					index: { type: "integer", description: "0-based index from list_components" },
					angleDeg: { type: "number", description: "rotation in degrees" },
				},
				required: ["index", "angleDeg"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "flip_component",
			description: "Mirror a component. horizontalAxis=true flips across the horizontal axis, false across the vertical.",
			parameters: {
				type: "object",
				properties: {
					index: { type: "integer", description: "0-based index from list_components" },
					horizontalAxis: { type: "boolean", description: "true = mirror across horizontal axis (default true)" },
				},
				required: ["index"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "delete_component",
			description: "Delete ONE component by index (from list_components). To wipe everything use clear instead. Only when the user asked to remove something.",
			parameters: {
				type: "object",
				properties: { index: { type: "integer", description: "0-based index from list_components" } },
				required: ["index"],
				additionalProperties: false,
			},
		},
	},
]

function runTool(
	name: string,
	args: {
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
		components?: number
		nets?: number
		maxDangling?: number
		connected?: [string, string][]
	}
): unknown {
	/** After every canvas WRITE the harness re-checks the circuit and staples the result onto the
	 *  tool output - the model cannot skip verification, and a broken edit is visible immediately. */
	const withCheck = (result: unknown): unknown => {
		try {
			const v = circuitAPI.verifyCircuit() as { pass: boolean; summary: unknown; problems?: unknown }
			const autoCheck =
				v.pass ?
					{ pass: true, summary: v.summary }
				:	{ pass: false, summary: v.summary, problems: v.problems }
			if (result && typeof result === "object" && !Array.isArray(result)) {
				return { ...(result as Record<string, unknown>), autoCheck }
			}
			return { result, autoCheck }
		} catch {
			return result
		}
	}
	const placeOpts = () => ({
		rotationDeg: args?.rotationDeg,
		lengthCm: args?.lengthCm,
		endX: args?.endX,
		endY: args?.endY,
		label: args?.label,
	})
	switch (name) {
		case "list_components":
			return circuitAPI.listComponents()
		case "get_component":
			return circuitAPI.getComponent(Number(args?.index))
		case "export_tikz":
			return circuitAPI.exportTikz()
		case "export_json":
			return circuitAPI.exportJson()
		case "describe_canvas":
			return circuitAPI.describeCanvas()
		case "list_symbols":
			return circuitAPI.listSymbols(args?.filter)
		case "verify_circuit":
			return circuitAPI.verifyCircuit({
				components: args?.components,
				nets: args?.nets,
				maxDangling: args?.maxDangling,
				connected: args?.connected,
			})
		case "get_logs":
			return circuitAPI.getLogs(args)
		case "import_tikz":
			return withCheck(circuitAPI.importTikz(String(args?.text ?? "")))
		case "add_component":
			return withCheck(circuitAPI.addComponent(String(args?.type ?? ""), Number(args?.x), Number(args?.y), placeOpts()))
		case "connect":
			return withCheck(circuitAPI.connect(String(args?.from ?? ""), String(args?.to ?? ""), args?.route ?? "auto"))
		case "place_relative":
			return withCheck(
				circuitAPI.placeRelative(
					String(args?.type ?? ""),
					String(args?.anchor ?? ""),
					Number(args?.dx ?? 0),
					Number(args?.dy ?? 0),
					placeOpts()
				)
			)
		case "move_component":
			return withCheck(circuitAPI.moveComponent(Number(args?.index), Number(args?.x), Number(args?.y)))
		case "rotate_component":
			return withCheck(circuitAPI.rotateComponent(Number(args?.index), Number(args?.angleDeg)))
		case "flip_component":
			return withCheck(circuitAPI.flipComponent(Number(args?.index), args?.horizontalAxis ?? true))
		case "delete_component":
			return withCheck(circuitAPI.deleteComponent(Number(args?.index)))
		case "clear":
			return circuitAPI.clear()
		default:
			return { error: "unknown tool: " + name }
	}
}

/** Pull a CircuiTikZ snippet out of a plain assistant reply (for endpoints without tool-calling). */
function extractTikz(text: string): string | null {
	const fence = text.match(/```(?:tikz|latex|circuitikz)?\s*([\s\S]*?)```/i)
	if (fence && /\\(draw|node|begin\s*\{)/.test(fence[1])) return fence[1].trim()
	const env = text.match(/\\begin\s*\{\s*(?:tikzpicture|circuitikz)\s*\}[\s\S]*?\\end\s*\{\s*(?:tikzpicture|circuitikz)\s*\}/)
	if (env) return env[0]
	const lines = text.split("\n").filter((l) => /\\(draw|node|coordinate)\b/.test(l))
	return lines.length ? lines.join("\n") : null
}

export class ChatController {
	private static _instance: ChatController
	public static get instance(): ChatController {
		return (ChatController._instance ??= new ChatController())
	}

	private messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }]
	private log!: HTMLDivElement
	private input!: HTMLTextAreaElement
	private panel!: HTMLDivElement
	private busy = false
	private bound = false
	/** Flips to false if the endpoint rejects the OpenAI `tools` param (then we use the Apply fallback). */
	private toolsSupported = true
	/** The user's most recent message - used to gate the destructive `clear` tool. */
	private lastUserText = ""
	/** Live activity indicator (D1): the bubble element, its base label, and the heartbeat timer id. */
	private activityEl: HTMLDivElement | null = null
	private activityBase = ""
	private heartbeat = 0
	/** Chat-history dropdown container (saved chat logs / sessions). */
	private historyEl!: HTMLDivElement
	/** Per-model cache of whether it advertises image input (for the selective visual-check feature). */
	private visionCache: Record<string, boolean> = {}

	public bind(): void {
		if (this.bound) return
		this.injectStyles()
		this.buildUI()
		this.bound = true
	}

	private injectStyles(): void {
		const css = `
		#ctkChatToggle{position:fixed;right:20px;bottom:20px;z-index:1080;width:52px;height:52px;border-radius:50%;
			border:none;cursor:pointer;background:var(--bs-orange,#d2691e);color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.3);
			font-size:24px;display:flex;align-items:center;justify-content:center}
		#ctkChatPanel{position:fixed;right:20px;bottom:84px;z-index:1080;width:min(380px,92vw);height:min(520px,70vh);
			display:none;flex-direction:column;border-radius:14px;overflow:hidden;background:var(--bs-body-bg,#fff);
			color:var(--bs-body-color,#222);border:1px solid var(--bs-border-color,#ccc);box-shadow:0 10px 40px rgba(0,0,0,.35)}
		#ctkChatPanel.open{display:flex}
		.ctkChatHead{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;
			background:var(--bs-secondary-bg,#f1f1f1);border-bottom:1px solid var(--bs-border-color,#ddd);font-weight:600}
		.ctkChatHead button{border:none;background:none;cursor:pointer;font-size:18px;color:inherit;line-height:1}
		#ctkChatLog{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;font-size:14px}
		.ctkMsg{max-width:85%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;word-break:break-word;line-height:1.35}
		.ctkMsg.user{align-self:flex-end;background:var(--bs-orange,#d2691e);color:#fff;border-bottom-right-radius:3px}
		.ctkMsg.assistant{align-self:flex-start;background:var(--bs-secondary-bg,#eee);border-bottom-left-radius:3px}
		.ctkMsg.system{align-self:center;background:transparent;color:var(--bs-secondary-color,#888);font-size:12.5px;text-align:center}
		.ctkMsg.thinking{opacity:.6;font-style:italic}
		.ctkTool{align-self:flex-start;font-size:12px;color:var(--bs-secondary-color,#777);
			background:var(--bs-tertiary-bg,#f6f6f6);border:1px dashed var(--bs-border-color,#ccc);border-radius:8px;padding:4px 8px;font-family:var(--font-mono,monospace)}
		.ctkChatInput{display:flex;gap:8px;padding:10px;border-top:1px solid var(--bs-border-color,#ddd)}
		.ctkChatInput textarea{flex:1;resize:none;height:40px;max-height:120px;border-radius:8px;border:1px solid var(--bs-border-color,#ccc);
			padding:8px 10px;font:inherit;background:var(--bs-body-bg,#fff);color:inherit}
		.ctkChatInput button{border:none;border-radius:8px;padding:0 14px;cursor:pointer;background:var(--bs-orange,#d2691e);color:#fff;font-weight:600}
		.ctkChatInput button:disabled{opacity:.5;cursor:default}
		.ctkChatHead .ctkHeadBtns{display:flex;gap:2px;align-items:center}
		.ctkHeadBtn{border:none;background:none;cursor:pointer;color:inherit;line-height:1;padding:3px;border-radius:6px;display:flex;align-items:center}
		.ctkHeadBtn:hover{background:var(--bs-tertiary-bg,#e9e9e9)}
		.ctkHeadBtn .material-symbols-outlined{font-size:19px}
		#ctkChatHistory{max-height:45%;overflow-y:auto;border-bottom:1px solid var(--bs-border-color,#ddd);background:var(--bs-tertiary-bg,#f6f6f6)}
		.ctkHistRow{display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid var(--bs-border-color,#eee);font-size:13px}
		.ctkHistRow:hover{background:var(--bs-secondary-bg,#eee)}
		.ctkHistTitle{flex:1;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
		.ctkHistAct{border:none;background:none;cursor:pointer;color:var(--bs-secondary-color,#888);display:flex;padding:2px;border-radius:4px}
		.ctkHistAct:hover{color:inherit;background:var(--bs-tertiary-bg,#e0e0e0)}
		.ctkHistAct .material-symbols-outlined{font-size:16px}
		.ctkHistEmpty{padding:12px;font-size:12.5px;color:var(--bs-secondary-color,#888);text-align:center}`
		const style = document.createElement("style")
		style.id = "ctkChatStyles"
		style.textContent = css
		document.head.appendChild(style)
	}

	private buildUI(): void {
		const toggle = document.createElement("button")
		toggle.id = "ctkChatToggle"
		toggle.title = "AI assistant (Beta)"
		toggle.innerHTML = '<span class="material-symbols-outlined">forum</span>'

		this.panel = document.createElement("div")
		this.panel.id = "ctkChatPanel"

		const head = document.createElement("div")
		head.className = "ctkChatHead"
		const headTitle = document.createElement("span")
		headTitle.textContent = "AI Assistant (Beta)"
		headTitle.style.marginRight = "auto"
		const headBtns = document.createElement("div")
		headBtns.className = "ctkHeadBtns"
		const mkBtn = (icon: string, title: string): HTMLButtonElement => {
			const b = document.createElement("button")
			b.className = "ctkHeadBtn"
			b.title = title
			b.innerHTML = '<span class="material-symbols-outlined">' + icon + "</span>"
			return b
		}
		const newBtn = mkBtn("add_comment", "New chat (saves the current one to history)")
		const visionBtn = mkBtn("visibility", "Visual check (Beta): screenshot the canvas and have a vision-capable model review what was built")
		const histBtn = mkBtn("history", "Chat history")
		const dlBtn = mkBtn("download", "Download this chat")
		const clearBtn = mkBtn("delete", "Clear chat (no save)")
		const close = document.createElement("button")
		close.className = "ctkHeadBtn"
		close.title = "Close"
		close.textContent = "✕"
		headBtns.append(newBtn, visionBtn, histBtn, dlBtn, clearBtn, close)
		head.append(headTitle, headBtns)
		newBtn.addEventListener("click", () => this.newChat())
		visionBtn.addEventListener("click", () => this.visualCheck())
		histBtn.addEventListener("click", () => this.toggleHistory())
		dlBtn.addEventListener("click", () => this.downloadTranscript())
		clearBtn.addEventListener("click", () => this.clearChat())

		this.historyEl = document.createElement("div")
		this.historyEl.id = "ctkChatHistory"
		this.historyEl.style.display = "none"

		this.log = document.createElement("div")
		this.log.id = "ctkChatLog"

		const inputRow = document.createElement("div")
		inputRow.className = "ctkChatInput"
		this.input = document.createElement("textarea")
		this.input.placeholder = "Ask the AI Beta assistant to build or edit your circuit…"
		const sendBtn = document.createElement("button")
		sendBtn.textContent = "Send"
		inputRow.appendChild(this.input)
		inputRow.appendChild(sendBtn)

		this.panel.append(head, this.historyEl, this.log, inputRow)
		document.body.append(toggle, this.panel)

		this.addBubble("system", GREETING)

		const open = () => {
			this.panel.classList.add("open")
			this.input.focus()
		}
		toggle.addEventListener("click", () => (this.panel.classList.contains("open") ? this.panel.classList.remove("open") : open()))
		close.addEventListener("click", () => this.panel.classList.remove("open"))
		sendBtn.addEventListener("click", () => this.send())
		this.input.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault()
				this.send()
			}
		})
	}

	// ---- Chat sessions & history ("chat logs") --------------------------------------------------

	/** Start a fresh chat, archiving the current one to history if it has any user turns. */
	public newChat(): void {
		this.archiveCurrent()
		this.resetConversation()
		this.historyEl.style.display = "none"
		logBus.info("tool", "new chat started")
	}

	/** Clear the current chat (display + context) WITHOUT saving it to history. */
	public clearChat(): void {
		this.resetConversation()
		logBus.info("tool", "chat cleared")
	}

	private resetConversation(): void {
		this.messages = [{ role: "system", content: SYSTEM_PROMPT }]
		this.lastUserText = ""
		this.log.textContent = ""
		this.addBubble("system", GREETING)
	}

	private loadHistory(): StoredChat[] {
		try {
			const v = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]")
			return Array.isArray(v) ? v : []
		} catch {
			return []
		}
	}
	private saveHistory(list: StoredChat[]): void {
		try {
			localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(-20)))
		} catch {
			/* storage unavailable or full - history is best-effort */
		}
	}
	private archiveCurrent(): void {
		const firstUser = this.messages.find((m) => m.role === "user")
		if (!firstUser) return // empty chat, nothing worth saving
		const title = (firstUser.content || "chat").slice(0, 60)
		const list = this.loadHistory()
		list.push({ id: String(Date.now()), title, ts: Date.now(), messages: this.messages.slice() })
		this.saveHistory(list)
	}

	private toggleHistory(): void {
		if (this.historyEl.style.display !== "none") {
			this.historyEl.style.display = "none"
			return
		}
		this.renderHistory()
		this.historyEl.style.display = "block"
	}
	private renderHistory(): void {
		const list = this.loadHistory().slice().reverse()
		this.historyEl.textContent = ""
		if (!list.length) {
			const empty = document.createElement("div")
			empty.className = "ctkHistEmpty"
			empty.textContent = "No saved chats yet. “New chat” saves the current conversation here."
			this.historyEl.appendChild(empty)
			return
		}
		for (const chat of list) {
			const row = document.createElement("div")
			row.className = "ctkHistRow"
			const label = document.createElement("span")
			label.className = "ctkHistTitle"
			label.textContent = chat.title || "(untitled)"
			label.title = new Date(chat.ts).toLocaleString() + " - click to open"
			label.addEventListener("click", () => this.loadChat(chat))
			const dl = document.createElement("button")
			dl.className = "ctkHistAct"
			dl.title = "Download transcript"
			dl.innerHTML = '<span class="material-symbols-outlined">download</span>'
			dl.addEventListener("click", (e) => {
				e.stopPropagation()
				this.downloadTranscript(chat.messages, chat.title)
			})
			const del = document.createElement("button")
			del.className = "ctkHistAct"
			del.title = "Delete"
			del.innerHTML = '<span class="material-symbols-outlined">close</span>'
			del.addEventListener("click", (e) => {
				e.stopPropagation()
				this.saveHistory(this.loadHistory().filter((c) => c.id !== chat.id))
				this.renderHistory()
			})
			row.append(label, dl, del)
			this.historyEl.appendChild(row)
		}
	}

	private loadChat(chat: StoredChat): void {
		this.archiveCurrent()
		this.messages = chat.messages.slice()
		this.lastUserText = [...this.messages].reverse().find((m) => m.role === "user")?.content || ""
		this.renderConversation()
		this.historyEl.style.display = "none"
	}

	/** Rebuild the visible bubbles from this.messages (used when loading a saved chat). */
	private renderConversation(): void {
		this.log.textContent = ""
		this.addBubble("system", GREETING)
		for (const m of this.messages) {
			if (m.role === "user") this.addBubble("user", contentText(m.content))
			else if (m.role === "assistant" && m.content) this.addBubble("assistant", contentText(m.content))
			else if (m.role === "assistant" && m.tool_calls) for (const tc of m.tool_calls) this.addToolNote(tc.function.name, safeParse(tc.function.arguments))
		}
		this.log.scrollTop = this.log.scrollHeight
	}

	private downloadTranscript(msgs: ChatMessage[] = this.messages, title = "chat"): void {
		const text = msgs
			.filter((m) => m.role !== "system")
			.map((m) => {
				if (m.role === "tool") return "TOOL RESULT: " + (typeof m.content === "string" ? m.content : "")
				const calls = m.tool_calls ? " " + m.tool_calls.map((t) => "[" + t.function.name + " " + t.function.arguments + "]").join(" ") : ""
				return m.role.toUpperCase() + ": " + contentText(m.content) + calls
			})
			.join("\n\n")
		const blob = new Blob([text], { type: "text/plain;charset=utf-8" })
		const a = document.createElement("a")
		a.href = URL.createObjectURL(blob)
		a.download = "circuitikz-chat-" + title.replace(/[^a-z0-9]+/gi, "-").slice(0, 30) + "-" + new Date().toISOString().replace(/[:.]/g, "-") + ".txt"
		document.body.appendChild(a)
		a.click()
		a.remove()
		setTimeout(() => URL.revokeObjectURL(a.href), 2000)
	}

	// ---- Visual check (vision-capable models only) ----------------------------------------------

	/** True if the selected model advertises image input (per the endpoint's /models metadata). Cached. */
	private async isVisionModel(cfg: { baseUrl?: string; apiKey: string; model: string }): Promise<boolean> {
		if (cfg.model in this.visionCache) return this.visionCache[cfg.model]
		let vision = false
		try {
			const url = (cfg.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "") + "/models"
			const res = await fetch(url, { headers: { Authorization: "Bearer " + cfg.apiKey } })
			if (res.ok) {
				const data = (await res.json()) as { data?: { id: string; input?: string[] }[] }
				const m = (data.data || []).find((x) => x.id === cfg.model)
				vision = !!(m && Array.isArray(m.input) && m.input.includes("image"))
			}
		} catch {
			/* if we cannot tell, assume no vision (fail safe) */
		}
		this.visionCache[cfg.model] = vision
		return vision
	}

	/** Screenshot the canvas and ask a vision-capable model to review what was actually built. */
	public async visualCheck(): Promise<void> {
		if (this.busy) return
		const cfg = this.getConfig()
		if (!cfg || cfg.id !== "openai-compat") {
			this.addBubble("system", "Set up the OpenAI-compatible AI Beta provider in Settings first.")
			return
		}
		this.addBubble("system", "Checking whether the model can see images…")
		if (!(await this.isVisionModel(cfg))) {
			this.addBubble(
				"system",
				"The current model (" +
					cfg.model +
					") does not accept images. Switch to a vision model (e.g. qwen3.5-122b-a10b, gemma-4-31b-it, internvl3.5-30b-a3b, mistral-large-3-675b-instruct-2512) to use visual check."
			)
			return
		}
		const png = await captureCanvasPng()
		if (!png) {
			logBus.error("tool", "visual check: canvas capture failed")
			this.addBubble("system", "Couldn't capture the canvas image.")
			return
		}
		logBus.info("tool", "visual check: captured canvas screenshot (" + png.length + " b64 chars)")
		const prompt =
			"This is a screenshot of the current circuit canvas. Compare it against what was requested and REPORT HONESTLY: point out any overlapping components, disconnected terminals, wrong values/labels, or layout problems you can see. If there are issues, fix them with the tools (describe_canvas to read real coordinates first, then move/rotate/delete/import_tikz). If it looks correct, say so briefly."
		this.addBubble("user", "🖼 [Sent a canvas screenshot for visual review]")
		this.messages.push({
			role: "user",
			content: [
				{ type: "text", text: prompt },
				{ type: "image_url", image_url: { url: png } },
			],
		})
		this.lastUserText = "visual review of the canvas"
		this.busy = true
		this.startActivity("looking at the canvas…")
		try {
			await this.agentLoop(cfg)
		} catch (e) {
			const detail = e instanceof Error ? e.message : String(e)
			logBus.error("tool", "visual check failed: " + detail)
			this.addBubble("system", "⚠ " + detail)
		} finally {
			this.stopActivity()
			this.busy = false
		}
	}

	private addBubble(role: "user" | "assistant" | "system", text: string, extra = ""): HTMLDivElement {
		const div = document.createElement("div")
		div.className = "ctkMsg " + role + (extra ? " " + extra : "")
		div.textContent = text
		this.log.appendChild(div)
		this.log.scrollTop = this.log.scrollHeight
		return div
	}

	private addToolNote(name: string, args: unknown): void {
		const div = document.createElement("div")
		div.className = "ctkTool"
		const argStr = args && Object.keys(args as object).length ? " " + JSON.stringify(args).slice(0, 80) : ""
		div.textContent = "\u{1F527} " + name + argStr
		this.log.appendChild(div)
		this.log.scrollTop = this.log.scrollHeight
	}

	/** Offer to apply a TikZ snippet the model wrote in plain text (no-tool-calling fallback). */
	private addApplyButton(tikz: string): void {
		const wrap = document.createElement("div")
		wrap.className = "ctkMsg assistant"
		const btn = document.createElement("button")
		btn.textContent = "Apply to canvas"
		btn.style.cssText =
			"border:none;border-radius:8px;padding:5px 10px;cursor:pointer;background:var(--bs-orange,#d2691e);color:#fff;font-weight:600;font-size:13px"
		btn.addEventListener("click", () => {
			try {
				circuitAPI.importTikz(tikz)
				btn.textContent = "Applied ✓"
				btn.disabled = true
				btn.style.opacity = "0.6"
			} catch (e) {
				btn.textContent = "Failed: " + (e instanceof Error ? e.message : String(e))
			}
		})
		wrap.appendChild(btn)
		this.log.appendChild(wrap)
		this.log.scrollTop = this.log.scrollHeight
	}

	private getConfig(): { id: string; baseUrl?: string; apiKey: string; model: string } | null {
		const id = getActiveProviderId()
		if (!id) return null
		const cfg = loadProviderConfig(id)
		if (!cfg) return null
		return { id, baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model }
	}

	public async send(): Promise<void> {
		if (this.busy) return
		const text = this.input.value.trim()
		if (!text) return
		this.input.value = ""
		this.addBubble("user", text)
		this.messages.push({ role: "user", content: text })
		this.lastUserText = text
		logBus.info("tool", "user: " + text.slice(0, 200))

		const cfg = this.getConfig()
		if (!cfg) {
			this.addBubble("system", "No AI Beta provider configured. Open Settings → AI Provider and set an OpenAI-compatible endpoint, API key, and model.")
			return
		}
		if (cfg.id !== "openai-compat") {
			this.addBubble("system", "In-app AI Beta chat currently supports the OpenAI-compatible provider. Switch to it in Settings.")
			return
		}

		this.busy = true
		this.startActivity("thinking…")
		try {
			await this.agentLoop(cfg)
		} catch (e) {
			const detail = e instanceof Error ? e.message : String(e)
			logBus.error("tool", "chat failed: " + detail)
			this.addBubble("system", "⚠ " + detail)
		} finally {
			this.stopActivity()
			this.busy = false
		}
	}

	/** D1: live activity bubble with an elapsed-seconds heartbeat so the agent never looks frozen. */
	private startActivity(label: string): void {
		this.activityBase = label
		this.activityEl = this.addBubble("assistant", label, "thinking")
		const t0 = Date.now()
		this.heartbeat = window.setInterval(() => {
			if (this.activityEl) this.activityEl.textContent = this.activityBase + " (" + Math.round((Date.now() - t0) / 1000) + "s)"
		}, 500)
	}
	private setActivity(label: string): void {
		this.activityBase = label
		if (this.activityEl) this.activityEl.textContent = label
	}
	private stopActivity(): void {
		if (this.heartbeat) {
			clearInterval(this.heartbeat)
			this.heartbeat = 0
		}
		this.activityEl?.remove()
		this.activityEl = null
	}

	/**
	 * D4: trim the history sent to the model - system prompt + a sliding window of recent turns + the
	 * drift reminder. Never starts the window on an orphan `tool` message (it must follow its assistant).
	 */
	private buildRequestMessages(): ChatMessage[] {
		const WINDOW = 24
		// Exactly ONE system message, at the very beginning: the prompt plus the anti-drift reminder.
		// Some endpoints reject any system message that is not first, so we must NOT append a trailing one.
		const sys: ChatMessage = {
			role: "system",
			content: (this.messages[0]?.content || SYSTEM_PROMPT) + "\n\n" + DRIFT_REMINDER,
		}
		const rest = this.messages.slice(1)
		let windowed = rest
		if (rest.length > WINDOW) {
			let start = rest.length - WINDOW
			while (start > 0 && rest[start].role === "tool") start--
			windowed = rest.slice(start)
		}
		return [sys, ...windowed]
	}

	/** D2: POST with harness-initiated auto-retry on transient network errors / 429 / 5xx. */
	private async postWithRetry(url: string, cfg: { apiKey: string; model: string }, withTools: boolean): Promise<Response> {
		const RETRYABLE = new Set([429, 500, 502, 503, 504])
		const maxAttempts = 4
		let lastErr: unknown
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const res = await fetch(url, {
					method: "POST",
					headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.apiKey },
					body: JSON.stringify({
						model: cfg.model,
						messages: this.buildRequestMessages(),
						...(withTools ? { tools: TOOLS, tool_choice: "auto" } : {}),
					}),
				})
				if (RETRYABLE.has(res.status) && attempt < maxAttempts) {
					const wait = backoffMs(attempt)
					logBus.warn("network", "AI HTTP " + res.status + ", retrying in " + wait + "ms (" + attempt + "/" + (maxAttempts - 1) + ")")
					this.setActivity("server busy, retrying… (" + attempt + "/" + (maxAttempts - 1) + ")")
					await sleep(wait)
					continue
				}
				return res
			} catch (e) {
				lastErr = e
				if (attempt < maxAttempts) {
					const wait = backoffMs(attempt)
					logBus.warn(
						"network",
						"AI request error (" + (e instanceof Error ? e.message : String(e)) + "), retrying in " + wait + "ms (" + attempt + "/" + (maxAttempts - 1) + ")"
					)
					this.setActivity("connection issue, retrying… (" + attempt + "/" + (maxAttempts - 1) + ")")
					await sleep(wait)
					continue
				}
			}
		}
		throw lastErr instanceof Error ? lastErr : new Error("The AI request failed after " + maxAttempts + " attempts.")
	}

	private async agentLoop(cfg: { baseUrl?: string; apiKey: string; model: string }): Promise<void> {
		const url = (cfg.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "") + "/chat/completions"
		for (let round = 0; round < 8; round++) {
			this.setActivity(round === 0 ? "thinking…" : "thinking… (step " + (round + 1) + ")")
			let res = await this.postWithRetry(url, cfg, this.toolsSupported)
			if (!res.ok && this.toolsSupported && (res.status === 400 || res.status === 422)) {
				// Endpoint may reject the `tools` param - fall back to plain chat + the Apply-TikZ button.
				this.toolsSupported = false
				logBus.info("tool", "endpoint rejected the tools param; retrying without tools")
				res = await this.postWithRetry(url, cfg, false)
			}
			if (!res.ok) {
				const body = await res.text().catch(() => "")
				logBus.error("network", "AI HTTP " + res.status, body.slice(0, 500))
				throw new Error("AI endpoint returned HTTP " + res.status + (body ? ": " + body.slice(0, 200) : ""))
			}
			let data: { choices?: { message: ChatMessage }[] }
			try {
				data = (await res.json()) as { choices?: { message: ChatMessage }[] }
			} catch {
				logBus.error("network", "AI response was not valid JSON")
				throw new Error("The AI endpoint returned a non-JSON response.")
			}
			const msg = data.choices?.[0]?.message
			if (!msg) {
				logBus.error("tool", "empty AI response", JSON.stringify(data).slice(0, 300))
				throw new Error("The model returned an empty response.")
			}
			this.messages.push(msg)

			const calls = msg.tool_calls ?? []
			if (msg.content) {
				this.addBubble("assistant", msg.content)
				// If the model answered in plain text (no tool calls) but included TikZ, offer to apply it.
				if (calls.length === 0) {
					const tikz = extractTikz(msg.content)
					if (tikz) this.addApplyButton(tikz)
				}
			}
			if (calls.length === 0) return

			for (const tc of calls) {
				let args: {
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
				} = {}
				try {
					args = JSON.parse(tc.function.arguments || "{}")
				} catch {
					/* leave args empty */
				}
				this.addToolNote(tc.function.name, args)
				this.setActivity("running " + tc.function.name + "…")
				let result: unknown
				if (tc.function.name === "clear" && !isResetIntent(this.lastUserText)) {
					// Guard: never let the model wipe the canvas unless the user actually asked to reset.
					result = {
						error:
							"clear refused: the user did not ask to reset the canvas. To edit, use delete_component / move_component / import_tikz instead. Only clear when the user explicitly asks to clear or start over.",
					}
				} else {
					try {
						result = runTool(tc.function.name, args)
					} catch (e) {
						result = { error: e instanceof Error ? e.message : String(e) }
					}
				}
				const hasErr = !!(result && typeof result === "object" && "error" in (result as Record<string, unknown>))
				logBus[hasErr ? "warn" : "info"]("tool", tc.function.name + (hasErr ? " ERROR" : ""), result)
				let content = JSON.stringify(result)
				if (content.length > 4000) content = content.slice(0, 4000) + "…[truncated]"
				this.messages.push({ role: "tool", tool_call_id: tc.id, content })
			}
		}
		logBus.warn("tool", "agent stopped after 8 tool rounds")
		this.addBubble("system", "Stopped after 8 tool rounds.")
	}
}
