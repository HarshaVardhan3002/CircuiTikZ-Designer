import * as SVG from "@svgdotjs/svg.js"
import {
	applyImportResult,
	CIRCUITIKZ_ALIASES,
	DiagnosticsCollector,
	ExportController,
	ImportController,
	MainController,
	transformTikz,
	type ComponentSymbol,
} from "./internal"
import { logBus, type LogFilter } from "./logBus"

/**
 * Programmatic Circuit API — a small, stable seam for driving the editor from outside the UI.
 *
 * Exposed on `window.circuitAPI`. This is the surface the in-app chat, the WebSocket harness bridge,
 * and the external MCP server all bridge to, so AI agents can INSPECT and EDIT the live circuit.
 * Keep this surface stable — it is a contract shared by every agent path.
 *
 * ── COORDINATE FRAME (the P0 translation layer) ─────────────────────────────────────────────────
 * EVERY coordinate that crosses this seam is in **TikZ centimetres, Y pointing UP** — exactly the
 * frame of `import_tikz` / `export_tikz`. Internally the editor works in pixels with Y pointing
 * down (1 cm = 4800/127 px); the conversion happens HERE, once, so agents read, write, and edit in
 * one single coordinate language. Never return or accept raw pixel coordinates on this surface.
 * (See CircuiTikZ-Designer_Harness_Cognition_Audit.md §1/§6-A for why this matters.)
 */

const CM_PER_PX = 127 / 4800
const PX_PER_CM = 4800 / 127

const round = (n: number): number => Math.round(n * 1000) / 1000

/** px / Y-down → cm / Y-up (TikZ frame). */
const pxToCmX = (xPx: number): number => round(xPx * CM_PER_PX)
const pxToCmY = (yPx: number): number => round(-yPx * CM_PER_PX)
/** cm / Y-up (TikZ frame) → px / Y-down. */
const cmToPxPoint = (xCm: number, yCm: number): SVG.Point => new SVG.Point(xCm * PX_PER_CM, -yCm * PX_PER_CM)

const components = () => MainController.instance.circuitComponents

function at(index: number) {
	const c = components()[index]
	if (!c) throw new Error(`No component at index ${index}. The canvas has ${components().length} component(s).`)
	return c
}

type AnyComponent = ReturnType<typeof components>[number]

/** Conductors: every snap point on these is ONE electrical node (a wire is a single conductor). */
const isConductor = (c: AnyComponent): boolean => c.displayName === "Wire" || c.displayName === "Short"

/** Best-effort instance name ("R1"), LaTeX label, rotation and TikZ type id via duck typing (mixins). */
const nameOf = (c: AnyComponent): string | null => (c as any).name?.value || null
const labelOf = (c: AnyComponent): string | null => (c as any).mathJaxLabel?.value || null
const rotationOf = (c: AnyComponent): number => {
	const r = (c as any).rotationDeg
	return typeof r === "number" ? round(r) : 0
}
const tikzTypeOf = (c: AnyComponent): string => (c as any).referenceSymbol?.tikzName || c.displayName

/** A pin = one snap point, with a stable name and its position in cm / Y-up. */
interface Pin {
	comp: number
	name: string
	x: number
	y: number
	/** wire corner points ("" name, not START/END) are conductors' bend points, not terminals */
	isTerminal: boolean
}

function pinsOf(c: AnyComponent, index: number): Pin[] {
	const conductor = isConductor(c)
	return (c.snappingPoints || []).map((p, i) => {
		const rawName: string = (p as any).name || ""
		const name = rawName !== "" ? rawName : `t${i}`
		const isCorner = conductor && rawName !== "START" && rawName !== "END"
		return {
			comp: index,
			name,
			x: pxToCmX(p.x),
			y: pxToCmY(p.y),
			isTerminal: !isCorner,
		}
	})
}

const pinRef = (p: Pin): string => `${p.comp}.${p.name}`

/** Union-find over pins: joined when coincident (same 0.001 cm bucket) or on the same conductor. */
function buildNets(allPins: Pin[]): Map<Pin, number> {
	const parent = allPins.map((_, i) => i)
	const find = (i: number): number => {
		while (parent[i] !== i) {
			parent[i] = parent[parent[i]]
			i = parent[i]
		}
		return i
	}
	const union = (a: number, b: number) => {
		const ra = find(a)
		const rb = find(b)
		if (ra !== rb) parent[rb] = ra
	}
	// coincident points
	const buckets = new Map<string, number[]>()
	allPins.forEach((p, i) => {
		const key = p.x + "," + p.y
		const arr = buckets.get(key) ?? []
		arr.push(i)
		buckets.set(key, arr)
	})
	for (const arr of buckets.values()) {
		for (let i = 1; i < arr.length; i++) union(arr[0], arr[i])
	}
	// conductor internals: all pins of one wire are one node
	const byComp = new Map<number, number[]>()
	allPins.forEach((p, i) => {
		const arr = byComp.get(p.comp) ?? []
		arr.push(i)
		byComp.set(p.comp, arr)
	})
	const comps = components()
	for (const [compIdx, pinIdxs] of byComp.entries()) {
		if (comps[compIdx] && isConductor(comps[compIdx])) {
			for (let i = 1; i < pinIdxs.length; i++) union(pinIdxs[0], pinIdxs[i])
		}
	}
	const groups = new Map<Pin, number>()
	allPins.forEach((p, i) => groups.set(p, find(i)))
	return groups
}

/** Component bbox in cm / Y-up, or null. */
function bboxCm(c: AnyComponent): { xMin: number; yMin: number; xMax: number; yMax: number; w: number; h: number } | null {
	const bb = c.bbox
	if (!bb) return null
	return {
		xMin: pxToCmX(bb.x),
		yMin: pxToCmY(bb.y + bb.height), // Y flip: px bottom edge = cm min-y
		xMax: pxToCmX(bb.x + bb.width),
		yMax: pxToCmY(bb.y), // px top edge = cm max-y
		w: round(bb.width * CM_PER_PX),
		h: round(bb.height * CM_PER_PX),
	}
}

/** Format a cm value for synthesized TikZ: up to 6 decimals, no trailing zeros. */
const fmt = (n: number): string => String(Math.round(n * 1e6) / 1e6)

/** Resolve a type name (canonical tikzName, dashed form, or CircuiTikZ alias like R/C/L/V) to a symbol. */
function resolveSymbol(name: string): ComponentSymbol | null {
	const symbols: ComponentSymbol[] = MainController.instance.symbols ?? []
	const lc = String(name).toLowerCase()
	const undashed = lc.replace(/-/g, " ")
	const direct = symbols.find((s) => {
		const t = s.tikzName?.toLowerCase()
		return t === lc || t === undashed
	})
	if (direct) return direct
	const aliases = CIRCUITIKZ_ALIASES[lc]
	if (aliases) {
		for (const cand of aliases) {
			const hit = symbols.find((s) => s.tikzName?.toLowerCase() === cand.toLowerCase())
			if (hit) return hit
		}
	}
	return null
}

/** Reverse alias map: canonical tikzName -> the short aliases that resolve to it (R, C, L, V, ...). */
function aliasTable(): Map<string, string[]> {
	const symbols: ComponentSymbol[] = MainController.instance.symbols ?? []
	const table = new Map<string, string[]>()
	for (const [alias, cands] of Object.entries(CIRCUITIKZ_ALIASES)) {
		for (const cand of cands) {
			const hit = symbols.find((s) => s.tikzName?.toLowerCase() === cand.toLowerCase())
			if (hit) {
				const arr = table.get(hit.tikzName) ?? []
				arr.push(alias)
				table.set(hit.tikzName, arr)
				break
			}
		}
	}
	return table
}

type QuietDiagnostic = { severity: string; message: string; suggestion?: string }

/**
 * Import synthesized TikZ WITHOUT UI side effects: always additive, never selects, never opens the
 * Import Report modal. Returns the created components and any non-info diagnostics so the calling
 * agent gets programmatic feedback instead of a modal.
 */
function importQuiet(tikz: string): { created: AnyComponent[]; diagnostics: QuietDiagnostic[] } {
	const result = transformTikz(tikz)
	const collector = new DiagnosticsCollector(tikz)
	for (const d of result.diagnostics) collector.add(d)
	let created: AnyComponent[] = []
	if (result.components.length > 0) {
		created = applyImportResult(result, {
			removeExisting: false,
			selectImported: false,
			collector,
		}) as AnyComponent[]
	}
	const diagnostics = collector
		.all()
		.filter((d) => d.severity !== "info")
		.map((d) => ({
			severity: d.severity,
			message: d.message,
			...(d.suggestion ? { suggestion: d.suggestion } : {}),
		}))
	return { created, diagnostics }
}

/**
 * Resolve an endpoint spec to a point in cm / Y-up. Accepts a pin reference like "3.START" / "0.G"
 * (component index + pin name, see describe_canvas) or a bare coordinate like "(2, 1.5)" / "2,1.5".
 */
function resolvePinOrPoint(spec: string): { x: number; y: number; resolved: string } {
	const s = String(spec).trim()
	const m = /^(\d+)\.(.+)$/.exec(s)
	if (m) {
		const idx = Number(m[1])
		const comp = components()[idx]
		if (comp) {
			const want = m[2].trim().toLowerCase()
			const hit = pinsOf(comp, idx).find((p) => p.name.toLowerCase() === want)
			if (hit) return { x: hit.x, y: hit.y, resolved: `${idx}.${hit.name}` }
		}
	}
	const c = /^\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?$/.exec(s)
	if (c) return { x: Number(c[1]), y: Number(c[2]), resolved: `(${c[1]},${c[2]})` }
	throw new Error(
		`Cannot resolve endpoint '${spec}'. Use a pin ref like '3.START' or '0.G' (indexes and pin names from describe_canvas), or a coordinate in cm like '(2, 1.5)'.`
	)
}

/** Compact one-line view of a component (type + reference position, cm / Y-up). */
function summarize(c: AnyComponent, index: number) {
	const name = nameOf(c)
	return {
		index,
		type: tikzTypeOf(c),
		...(name ? { name } : {}),
		x: c.position ? pxToCmX(c.position.x) : null,
		y: c.position ? pxToCmY(c.position.y) : null,
	}
}

export const circuitAPI = {
	/** List every component on the canvas (type + reference position in cm, Y-up). Read-only. */
	listComponents(): ReturnType<typeof summarize>[] {
		return components().map((c, i) => summarize(c, i))
	},

	/** Number of components on the canvas. */
	count(): number {
		return components().length
	},

	/**
	 * Full detail for a single component: reference position, bounding box, named pins, rotation,
	 * name/label, its CircuiTikZ, and its serialized state. ALL coordinates in cm, Y-up (the TikZ
	 * frame — identical to what import_tikz/export_tikz use). Read-only.
	 */
	getComponent(index: number): Record<string, unknown> {
		const c = at(index)
		let json: unknown = null
		let tikz = ""
		try {
			json = c.toJson()
		} catch {
			/* some components may not serialize in isolation */
		}
		try {
			tikz = c.toTikzString()
		} catch {
			/* ignore */
		}
		const name = nameOf(c)
		const label = labelOf(c)
		const rotationDeg = rotationOf(c)
		return {
			index,
			type: tikzTypeOf(c),
			displayType: c.displayName,
			...(name ? { name } : {}),
			...(label ? { label } : {}),
			...(rotationDeg !== 0 ? { rotationDeg } : {}),
			x: c.position ? pxToCmX(c.position.x) : null,
			y: c.position ? pxToCmY(c.position.y) : null,
			bbox: bboxCm(c),
			pins: pinsOf(c, index).map((p) => ({ name: p.name, x: p.x, y: p.y })),
			tikz,
			json,
		}
	},

	/** Export the whole circuit as CircuiTikZ source (no UI side effects). Read-only. */
	exportTikz(): string {
		return ExportController.instance.buildCircuiTikZString()
	},

	/** Export the whole circuit as the editor's native JSON save objects (one per component). Read-only. */
	exportJson(): unknown[] {
		return components().map((c) => {
			try {
				return c.toJson()
			} catch {
				return { type: c.displayName }
			}
		})
	},

	/**
	 * THE canvas report for agents — everything in cm, Y-up (the TikZ frame). Per component: type,
	 * name, label, rotation, position, SIZE, and named pins. Plus the electrical analysis the model
	 * cannot compute itself: `nets` (which pins are joined, wires traced as conductors), `dangling`
	 * (terminals connected to nothing), `overlaps` (bounding-box collisions between parts), and
	 * `nearMisses` (pins that ALMOST touch — closer than 0.2 cm — but are NOT connected: usually a
	 * wiring mistake). Use this to verify work instead of claiming success. Read-only.
	 */
	describeCanvas(): Record<string, unknown> {
		const comps = components()
		const allPins: Pin[] = []
		const compInfos = comps.map((c, index) => {
			const pins = pinsOf(c, index)
			allPins.push(...pins)
			const name = nameOf(c)
			const label = labelOf(c)
			const rotationDeg = rotationOf(c)
			const bb = bboxCm(c)
			return {
				index,
				type: tikzTypeOf(c),
				...(name ? { name } : {}),
				...(label ? { label } : {}),
				...(rotationDeg !== 0 ? { rotationDeg } : {}),
				x: c.position ? pxToCmX(c.position.x) : null,
				y: c.position ? pxToCmY(c.position.y) : null,
				...(bb ? { size: { w: bb.w, h: bb.h } } : {}),
				pins: pins.map((p) => ({ name: p.name, x: p.x, y: p.y })),
			}
		})

		// nets: union-find over coincident pins + conductor internals
		const groups = buildNets(allPins)
		const byGroup = new Map<number, Pin[]>()
		for (const [pin, g] of groups.entries()) {
			const arr = byGroup.get(g) ?? []
			arr.push(pin)
			byGroup.set(g, arr)
		}
		const nets: { id: string; components: number[]; pins: string[] }[] = []
		const danglingPins: { pin: string; x: number; y: number }[] = []
		let netCounter = 0
		for (const pins of byGroup.values()) {
			const compSet = [...new Set(pins.map((p) => p.comp))]
			if (compSet.length > 1) {
				nets.push({
					id: "N" + ++netCounter,
					components: compSet.sort((a, b) => a - b),
					pins: pins.filter((p) => p.isTerminal).map(pinRef),
				})
			} else {
				// single-component group: its terminals are dangling (connected to nothing)
				for (const p of pins) {
					if (p.isTerminal) danglingPins.push({ pin: pinRef(p), x: p.x, y: p.y })
				}
			}
		}

		// near misses: terminal pins of different components, closer than 0.2 cm, NOT connected
		const NEAR = 0.2
		const nearMisses: { a: string; b: string; gapCm: number }[] = []
		const terminals = allPins.filter((p) => p.isTerminal)
		outer: for (let i = 0; i < terminals.length; i++) {
			for (let j = i + 1; j < terminals.length; j++) {
				const a = terminals[i]
				const b = terminals[j]
				if (a.comp === b.comp) continue
				if (groups.get(a) === groups.get(b)) continue
				const dx = a.x - b.x
				const dy = a.y - b.y
				if (dx > NEAR || dx < -NEAR || dy > NEAR || dy < -NEAR) continue
				const gap = Math.sqrt(dx * dx + dy * dy)
				if (gap <= NEAR && gap > 0.0005) {
					nearMisses.push({ a: pinRef(a), b: pinRef(b), gapCm: round(gap) })
					if (nearMisses.length >= 20) break outer
				}
			}
		}

		// overlaps: bounding-box collisions between non-conductor parts (penetration > 0.05 cm both axes)
		const overlaps: { a: string; b: string; overlapW: number; overlapH: number }[] = []
		const boxes = comps.map((c) => (isConductor(c) ? null : bboxCm(c)))
		for (let i = 0; i < boxes.length && overlaps.length < 30; i++) {
			const A = boxes[i]
			if (!A) continue
			for (let j = i + 1; j < boxes.length && overlaps.length < 30; j++) {
				const B = boxes[j]
				if (!B) continue
				const w = Math.min(A.xMax, B.xMax) - Math.max(A.xMin, B.xMin)
				const h = Math.min(A.yMax, B.yMax) - Math.max(A.yMin, B.yMin)
				if (w > 0.05 && h > 0.05) {
					overlaps.push({
						a: `${i}:${tikzTypeOf(comps[i])}`,
						b: `${j}:${tikzTypeOf(comps[j])}`,
						overlapW: round(w),
						overlapH: round(h),
					})
				}
			}
		}

		return {
			frame: "All coordinates in cm, Y-up — the SAME frame as import_tikz/export_tikz. Pin refs are '<componentIndex>.<pinName>'.",
			count: comps.length,
			components: compInfos,
			nets,
			dangling: danglingPins,
			overlaps,
			nearMisses,
		}
	},

	/** Add components from a CircuiTikZ or JSON string. ADDITIVE (appends). Throws on an unknown format. */
	importTikz(text: string): { ok: true; count: number } {
		const before = components().length
		ImportController.instance.importString(text)
		const count = components().length
		logBus.info("circuit", "importTikz +" + (count - before) + " (now " + count + ")", text.slice(0, 200))
		return { ok: true, count }
	},

	/**
	 * The symbol catalog. Without a filter: a compact list of every placeable type (tikz id, display
	 * name, kind, aliases). With a filter (substring of id/name/group/alias): full detail for up to 40
	 * matches, including footprint size and — for node symbols — named pins with offsets from the
	 * reference point in cm (default variant, unrotated). Read-only.
	 */
	listSymbols(filter?: string): Record<string, unknown> {
		const symbols: ComponentSymbol[] = MainController.instance.symbols ?? []
		const aliases = aliasTable()
		const f = filter ? String(filter).toLowerCase().trim() : ""
		const matches = symbols.filter((s) => {
			if (!f) return true
			return (
				s.tikzName?.toLowerCase().includes(f) ||
				s.displayName?.toLowerCase().includes(f) ||
				s.groupName?.toLowerCase().includes(f) ||
				(aliases.get(s.tikzName) ?? []).some((a) => a.includes(f))
			)
		})
		if (!f) {
			return {
				count: matches.length,
				hint: "Types with kind 'path' are bipoles placed BETWEEN two points (add_component start + direction/end). Types with kind 'node' sit AT one point. Call list_symbols({filter}) for pins/sizes.",
				symbols: matches.map((s) => ({
					tikz: s.tikzName,
					display: s.displayName,
					kind: s.isNodeSymbol ? "node" : "path",
					...(aliases.get(s.tikzName) ? { aliases: aliases.get(s.tikzName) } : {}),
				})),
			}
		}
		const detailed = matches.slice(0, 40).map((s) => {
			let pins: { name: string; dx: number; dy: number }[] = []
			try {
				pins = (s.getVariant([])?.pins ?? [])
					.filter((p) => p.point)
					.map((p, i) => ({
						name: p.name || `t${i}`,
						dx: pxToCmX(p.point.x),
						dy: pxToCmY(p.point.y),
					}))
			} catch {
				/* symbol without a resolvable default variant */
			}
			return {
				tikz: s.tikzName,
				display: s.displayName,
				group: s.groupName,
				kind: s.isNodeSymbol ? "node" : "path",
				...(aliases.get(s.tikzName) ? { aliases: aliases.get(s.tikzName) } : {}),
				...(s.viewBox ? { size: { w: round(s.viewBox.width * CM_PER_PX), h: round(s.viewBox.height * CM_PER_PX) } } : {}),
				...(s.isNodeSymbol ?
					{ pins }
				:	{ pins: "START and END sit at the two endpoints you give; the symbol renders between them" }),
			}
		})
		return { count: matches.length, symbols: detailed, ...(matches.length > 40 ? { truncated: true } : {}) }
	},

	/**
	 * Place ONE component — no hand-written TikZ. `type` is a tikz id or alias from list_symbols
	 * (R, C, L, V, I, D, nmos, ground, …). For PATH symbols (bipoles) (x,y) is the START terminal;
	 * give either end{X,Y} or rotationDeg (direction, 0 = +x, CCW) + lengthCm (default 2). For NODE
	 * symbols (x,y) is the reference point and rotationDeg rotates the symbol. Returns the new
	 * component's index and its live pins in cm so you can connect immediately.
	 */
	addComponent(
		type: string,
		x: number,
		y: number,
		opts: { rotationDeg?: number; lengthCm?: number; endX?: number; endY?: number; label?: string } = {}
	): Record<string, unknown> {
		const sym = resolveSymbol(type)
		if (!sym) {
			throw new Error(
				`Unknown component type '${type}'. Call list_symbols (optionally with a filter) to see every available type and alias.`
			)
		}
		const label = opts.label ? String(opts.label).replace(/[$\]\n\r]/g, "").trim() : ""
		let tikz: string
		if (sym.isNodeSymbol) {
			const rot = opts.rotationDeg ? `, rotate=${fmt(opts.rotationDeg)}` : ""
			tikz = `\\node[${sym.tikzName}${rot}] at (${fmt(x)}, ${fmt(y)}) {};`
		} else {
			let ex: number
			let ey: number
			if (typeof opts.endX === "number" && typeof opts.endY === "number") {
				ex = opts.endX
				ey = opts.endY
			} else {
				const len = typeof opts.lengthCm === "number" && opts.lengthCm > 0 ? opts.lengthCm : 2
				const ang = (((opts.rotationDeg ?? 0) % 360) * Math.PI) / 180
				ex = x + len * Math.cos(ang)
				ey = y + len * Math.sin(ang)
			}
			const key = label ? `${sym.tikzName}=$${label}$` : sym.tikzName
			tikz = `\\draw (${fmt(x)}, ${fmt(y)}) to[${key}] (${fmt(ex)}, ${fmt(ey)});`
		}
		const { created, diagnostics } = importQuiet(tikz)
		if (created.length === 0) {
			throw new Error(
				`add_component created nothing. ${diagnostics.map((d) => d.message).join(" | ") || "The importer produced no component."} (synthesized: ${tikz})`
			)
		}
		const index = components().indexOf(created[0])
		logBus.info("circuit", `addComponent ${sym.tikzName} @ (${fmt(x)}, ${fmt(y)}) cm -> #${index}`, tikz)
		return {
			ok: true,
			index,
			type: sym.tikzName,
			kind: sym.isNodeSymbol ? "node" : "path",
			pins: pinsOf(components()[index], index).map((p) => ({ name: p.name, x: p.x, y: p.y })),
			...(label && sym.isNodeSymbol ?
				{ note: "label is not supported for node symbols here; add it via import_tikz or the UI" }
			:	{}),
			...(diagnostics.length ? { diagnostics } : {}),
			...(created.length > 1 ? { alsoCreated: created.length - 1 } : {}),
		}
	},

	/**
	 * Wire two points together — the harness computes the route, you never hand-write wire TikZ.
	 * Endpoints are pin refs like "3.START" / "0.G" (from describe_canvas / add_component) or bare
	 * cm coordinates like "(2, 1.5)". route: "auto" (default) draws a straight wire when the points
	 * are axis-aligned and an L-shaped horizontal-then-vertical wire otherwise; "hv"/"vh" force the
	 * L orientation; "direct" forces a straight (possibly diagonal) wire.
	 */
	connect(
		from: string,
		to: string,
		route: "auto" | "direct" | "hv" | "vh" = "auto"
	): Record<string, unknown> {
		const a = resolvePinOrPoint(from)
		const b = resolvePinOrPoint(to)
		if (a.x === b.x && a.y === b.y) {
			return { ok: true, alreadyConnected: true, at: { x: a.x, y: a.y } }
		}
		const aligned = Math.abs(a.x - b.x) < 0.005 || Math.abs(a.y - b.y) < 0.005
		const r = route === "auto" ? (aligned ? "direct" : "hv") : route
		const pts: { x: number; y: number }[] =
			r === "direct" ? [a, b]
			: r === "hv" ? [a, { x: b.x, y: a.y }, b]
			: [a, { x: a.x, y: b.y }, b]
		const tikz = "\\draw " + pts.map((p) => `(${fmt(p.x)}, ${fmt(p.y)})`).join(" -- ") + ";"
		const { created, diagnostics } = importQuiet(tikz)
		if (created.length === 0) {
			throw new Error(
				`connect created no wire. ${diagnostics.map((d) => d.message).join(" | ") || ""} (synthesized: ${tikz})`
			)
		}
		const index = components().indexOf(created[0])
		logBus.info("circuit", `connect ${a.resolved} -> ${b.resolved} (${r}) -> wire #${index}`)
		return {
			ok: true,
			index,
			from: a.resolved,
			to: b.resolved,
			route: r,
			...(diagnostics.length ? { diagnostics } : {}),
		}
	},

	/**
	 * Place a component RELATIVE to an existing pin: anchor is a pin ref like "2.END" (or a
	 * coordinate), dx/dy are offsets in cm. Everything else behaves like add_component. Use this to
	 * grow a circuit without recomputing absolute coordinates.
	 */
	placeRelative(
		type: string,
		anchor: string,
		dx: number,
		dy: number,
		opts: { rotationDeg?: number; lengthCm?: number; endX?: number; endY?: number; label?: string } = {}
	): Record<string, unknown> {
		const base = resolvePinOrPoint(anchor)
		const res = circuitAPI.addComponent(type, base.x + dx, base.y + dy, opts)
		return { ...res, anchor: base.resolved, at: { x: round(base.x + dx), y: round(base.y + dy) } }
	},

	/**
	 * Harness-computed pass/fail — the agent never self-certifies. Checks overlaps, near-misses
	 * (almost-touching pins), optional expectations (component count, net count, max dangling
	 * terminals, specific pin pairs that must share a net), and recent runtime errors. Returns
	 * { pass, summary, problems? }. Call after building; if pass is false, repair and re-verify.
	 */
	verifyCircuit(
		expect: { components?: number; nets?: number; maxDangling?: number; connected?: [string, string][] } = {}
	): Record<string, unknown> {
		const d = circuitAPI.describeCanvas() as {
			count: number
			nets: { id: string; pins: string[] }[]
			dangling: { pin: string; x: number; y: number }[]
			overlaps: unknown[]
			nearMisses: { a: string; b: string; gapCm: number }[]
		}
		const problems: Record<string, unknown>[] = []
		for (const o of d.overlaps) problems.push({ kind: "overlap", ...(o as Record<string, unknown>) })
		for (const n of d.nearMisses) {
			problems.push({
				kind: "nearMiss",
				...n,
				hint: "these pins are NOT connected; move one endpoint by the gap so the coordinates match exactly",
			})
		}
		if (typeof expect.components === "number" && d.count !== expect.components) {
			problems.push({ kind: "expectation", message: `expected ${expect.components} components, canvas has ${d.count}` })
		}
		if (typeof expect.nets === "number" && d.nets.length !== expect.nets) {
			problems.push({ kind: "expectation", message: `expected ${expect.nets} nets, canvas has ${d.nets.length}` })
		}
		if (typeof expect.maxDangling === "number" && d.dangling.length > expect.maxDangling) {
			problems.push({
				kind: "expectation",
				message: `${d.dangling.length} dangling terminal(s) exceed the allowed ${expect.maxDangling}`,
				dangling: d.dangling.map((x) => x.pin),
			})
		}
		if (Array.isArray(expect.connected)) {
			for (const pair of expect.connected) {
				if (!Array.isArray(pair) || pair.length !== 2) continue
				const pa = String(pair[0])
				const pb = String(pair[1])
				const net = d.nets.find((n) => n.pins.includes(pa))
				if (!net) {
					problems.push({ kind: "notConnected", a: pa, b: pb, message: `${pa} is not on any net` })
				} else if (!net.pins.includes(pb)) {
					problems.push({ kind: "notConnected", a: pa, b: pb, message: `${pa} and ${pb} are on different nets` })
				}
			}
		}
		const recentErrors = logBus.get({ level: "error" as LogFilter["level"], since: Date.now() - 30000, limit: 5 })
		if (recentErrors.length > 0) {
			problems.push({
				kind: "recentErrors",
				count: recentErrors.length,
				hint: "call get_logs({level:'error'}) for detail",
			})
		}
		return {
			pass: problems.length === 0,
			summary: {
				components: d.count,
				nets: d.nets.length,
				dangling: d.dangling.length,
				overlaps: d.overlaps.length,
				nearMisses: d.nearMisses.length,
			},
			...(d.dangling.length ? { danglingPins: d.dangling.map((x) => x.pin) } : {}),
			...(problems.length ? { problems } : {}),
		}
	},

	/** Move a component so its reference point sits at (x, y) in cm, Y-up — the TikZ frame. */
	moveComponent(index: number, x: number, y: number): { ok: true } {
		const c = at(index)
		c.moveTo(cmToPxPoint(x, y))
		c.recalculateSnappingPoints()
		logBus.info("circuit", "moveComponent #" + index + " (" + c.displayName + ") -> (" + round(x) + ", " + round(y) + ") cm")
		return { ok: true }
	},

	/** Rotate a component by angleDeg degrees (positive = counter-clockwise, TikZ convention). */
	rotateComponent(index: number, angleDeg: number): { ok: true } {
		const c = at(index)
		c.rotate(angleDeg)
		c.recalculateSnappingPoints()
		logBus.info("circuit", "rotateComponent #" + index + " (" + c.displayName + ") by " + angleDeg + "deg")
		return { ok: true }
	},

	/** Flip a component. horizontalAxis=true mirrors across the horizontal axis, else vertical. */
	flipComponent(index: number, horizontalAxis = true): { ok: true } {
		const c = at(index)
		c.flip(horizontalAxis)
		c.recalculateSnappingPoints()
		logBus.info("circuit", "flipComponent #" + index + " (" + c.displayName + ") " + (horizontalAxis ? "horizontal" : "vertical"))
		return { ok: true }
	},

	/** Delete a single component by index. Returns the new component count. */
	deleteComponent(index: number): { ok: true; count: number } {
		const c = at(index)
		const label = c.displayName
		MainController.instance.removeComponent(c)
		logBus.warn("circuit", "deleteComponent #" + index + " (" + label + ") -> " + components().length + " left")
		return { ok: true, count: components().length }
	},

	/** Remove every component from the canvas. */
	clear(): { ok: true } {
		const n = components().length
		for (const c of [...components()]) {
			MainController.instance.removeComponent(c)
		}
		logBus.warn("circuit", "clear removed " + n + " component(s)")
		return { ok: true }
	},

	/**
	 * Read recent application logs (console, network, errors, tool calls, circuit edits). Lets the agent
	 * inspect what actually happened and self-correct. Read-only. Newest last, capped by `limit`.
	 */
	getLogs(filter: { level?: string; source?: string; contains?: string; since?: number; limit?: number } = {}): unknown[] {
		return logBus.get({
			level: filter.level as LogFilter["level"],
			source: filter.source as LogFilter["source"],
			contains: filter.contains,
			since: filter.since,
			limit: filter.limit ?? 50,
		})
	},
}

export type CircuitAPI = typeof circuitAPI
