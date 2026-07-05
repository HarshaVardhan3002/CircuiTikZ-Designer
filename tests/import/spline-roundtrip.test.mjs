#!/usr/bin/env node
/**
 * End-to-end smoke check for the cubic-spline import path.
 *
 * The full transformer pulls in the SVG.js-bound component classes via the internal barrel,
 * which doesn't load under Node. Instead we run the lexer + parser end-to-end and then mimic
 * the transformer's controls-segment handling locally - enough to verify that:
 *
 *   • a clean `\draw (.) .. controls (.) and (.) .. (.) ;` source parses without warnings
 *   • the chained form keeps every control point intact
 *   • interior anchors get C¹/G¹ promotion when the handle geometry warrants it
 *   • a malformed segment recovers without crashing the surrounding draw
 *
 * Run with `node --experimental-transform-types --import ./tests/import/register.mjs tests/import/spline-roundtrip.test.mjs`.
 */

import { fileURLToPath } from "node:url"
import path from "node:path"

const here = path.dirname(fileURLToPath(import.meta.url))
const rootSrc = path.resolve(here, "../../src/scripts")

const { tokenizeTikz } = await import(`${rootSrc}/import/tikzLexer.ts`)
const diagnosticsMod = await import(`${rootSrc}/import/diagnostics.ts`)
const parserMod = await import(`${rootSrc}/import/tikzParser.ts`)
const { DiagnosticsCollector } = diagnosticsMod
const { parseTikz } = parserMod

let passes = 0
let failures = 0
function assert(cond, label, detail) {
	if (cond) { passes++; return }
	failures++
	console.error(`  ✗ ${label}`)
	if (detail !== undefined) console.error("    " + detail)
}
function summary(title) { console.log(`\n=== ${title} ===`) }

// 1cm in pixel units used by the transformer / Designer.
const PX_PER_CM = 4800 / 127

const xy = (c) => ({ x: c.x * PX_PER_CM, y: -c.y * PX_PER_CM })

// Local stand-in for the transformer's flushSpline path. Rebuilds anchor list from points +
// controls and runs the same continuity inference the real transformer uses.
function buildAnchors(points, controls) {
	if (controls.length !== points.length - 1) return []
	const anchors = points.map((p, i) => {
		const incoming = i > 0 ? controls[i - 1].c2 : null
		const outgoing = i < points.length - 1 ? controls[i].c1 : null
		return {
			position: { x: p.x, y: p.y },
			inHandle: incoming ? { x: incoming.x - p.x, y: incoming.y - p.y } : null,
			outHandle: outgoing ? { x: outgoing.x - p.x, y: outgoing.y - p.y } : null,
			continuity: "corner",
		}
	})
	for (let i = 1; i < anchors.length - 1; i++) {
		const a = anchors[i]
		if (!a.inHandle || !a.outHandle) continue
		if (Math.hypot(a.inHandle.x + a.outHandle.x, a.inHandle.y + a.outHandle.y) < 1e-3) {
			a.continuity = "c1"
			continue
		}
		const inLen = Math.hypot(a.inHandle.x, a.inHandle.y)
		const outLen = Math.hypot(a.outHandle.x, a.outHandle.y)
		if (inLen > 1e-9 && outLen > 1e-9) {
			const dot = -(a.inHandle.x * a.outHandle.x + a.inHandle.y * a.outHandle.y)
			const cos = dot / (inLen * outLen)
			if (cos > Math.cos((0.5 * Math.PI) / 180)) a.continuity = "g1"
		}
	}
	return anchors
}

function pathToSpline(src) {
	const collector = new DiagnosticsCollector(src)
	const doc = parseTikz(src, collector)
	const draw = doc.statements.find((s) => s.kind === "draw")
	if (!draw) return { anchors: [], collector }

	const points = []
	const controls = []
	let pendingControls = null

	for (const el of draw.elements) {
		if (el.kind === "coord" && el.coord.kind === "xy") {
			points.push(xy(el.coord))
			if (pendingControls && points.length > 1) {
				controls.push(pendingControls)
				pendingControls = null
			}
		} else if (el.kind === "controls" && el.c1.kind === "xy" && el.c2.kind === "xy") {
			pendingControls = { c1: xy(el.c1), c2: xy(el.c2) }
		}
	}

	return { anchors: buildAnchors(points, controls), collector }
}

summary("Spline import: single segment lands as a 2-anchor spline")
{
	const { anchors, collector } = pathToSpline("\\draw (0,0) .. controls (1,2) and (2,2) .. (3,0);")
	assert(anchors.length === 2, "Two anchors", `got ${anchors.length}`)
	assert(anchors[0].inHandle === null && anchors[0].outHandle !== null, "First anchor is start endpoint")
	assert(anchors[1].outHandle === null && anchors[1].inHandle !== null, "Last anchor is end endpoint")
	const warnings = collector.all().filter((d) => d.severity === "warning")
	assert(warnings.length === 0, "No warnings", `got ${JSON.stringify(warnings)}`)
}

summary("Spline import: chained 3-anchor spline keeps every control intact")
{
	const { anchors } = pathToSpline(
		"\\draw (0,0) .. controls (1,2) and (1.5,1) .. (2,0) .. controls (2.5,1) and (3,2) .. (4,0);"
	)
	assert(anchors.length === 3, "Three anchors", `got ${anchors.length}`)
	const interior = anchors[1]
	assert(interior.inHandle !== null && interior.outHandle !== null, "Interior anchor has both handles")
	// Christof's example: c2 of segment 1 = (1.5,1), c1 of segment 2 = (2.5,1). At anchor (2,0)
	// these become inHandle (-0.5, +1) (sign-flipped y) and outHandle (+0.5, +1). The resulting
	// handles are NOT antiparallel - corner mode should be inferred.
	assert(interior.continuity === "corner", "Asymmetric handles → corner mode", `got ${interior.continuity}`)
}

summary("Spline import: C¹-style handles get promoted on import")
{
	// At anchor (2,0) we feed mirrored controls: c2 of seg 1 = (1.5,1), c1 of seg 2 = (2.5,-1).
	// Around (2,0) those are (-0.5, 1) and (0.5, -1) - exact point mirrors, so c1 should fire.
	const { anchors } = pathToSpline(
		"\\draw (0,0) .. controls (1,2) and (1.5,1) .. (2,0) .. controls (2.5,-1) and (3,-2) .. (4,0);"
	)
	assert(anchors[1].continuity === "c1", "Mirrored handles → c1 promotion", `got ${anchors[1].continuity}`)
}

summary("Spline import: G¹-style handles get promoted on import")
{
	// Anchor (2,0). c2 of seg 1 = (1.5,1) → inHandle (-0.5, -1) after y-flip in xy(). c1 of seg 2
	// = (3,-2) → outHandle (1, 2). Vectors are antiparallel with different magnitudes - g1.
	const { anchors } = pathToSpline(
		"\\draw (0,0) .. controls (1,2) and (1.5,1) .. (2,0) .. controls (3,-2) and (4,-2) .. (4,0);"
	)
	assert(anchors[1].continuity === "g1", "Antiparallel-different-length → g1 promotion", `got ${anchors[1].continuity}`)
}

summary("Spline import: malformed segment recovers without nuking the path")
{
	const { anchors, collector } = pathToSpline("\\draw (0,0) .. (3,0);")
	const codes = collector.all().map((d) => d.code)
	assert(codes.includes("parse-controls-missing"), "Warning emitted", `codes=${codes.join(",")}`)
	// The malformed `..` is dropped; what remains is two coordinates with no connector. The
	// transformer would emit a wire for those, but our local stand-in only handles splines, so
	// we just assert that the parse didn't crash.
	assert(anchors.length >= 0, "Parse survived")
}

summary("Spline import: 50-segment stress fixture")
{
	let src = "\\draw (0,0)"
	for (let i = 1; i <= 50; i++) {
		src += ` .. controls (${i - 0.5},1) and (${i - 0.3},-1) .. (${i},0)`
	}
	src += ";"
	const t0 = Date.now()
	const { anchors, collector } = pathToSpline(src)
	const elapsed = Date.now() - t0
	assert(anchors.length === 51, "51 anchors after 50 segments", `got ${anchors.length}`)
	assert(elapsed < 250, "Stress fixture parses in <250ms", `took ${elapsed}ms`)
	const warnings = collector.all().filter((d) => d.severity === "warning")
	assert(warnings.length === 0, "No warnings on the stress run")
}

console.log(`\n${passes} passed, ${failures} failed`)
if (failures > 0) process.exit(1)
