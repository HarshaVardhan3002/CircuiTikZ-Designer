#!/usr/bin/env node
/**
 * Stress check for the spline parser path. This deliberately throws odd inputs at the parser
 * - randomised coordinates, malformed segments, deep multi-segment chains - and asserts that
 * we never crash, never error, and recover diagnostically when the source is bent.
 */

import { fileURLToPath } from "node:url"
import path from "node:path"

const here = path.dirname(fileURLToPath(import.meta.url))
const rootSrc = path.resolve(here, "../../src/scripts")
const { tokenizeTikz } = await import(`${rootSrc}/import/tikzLexer.ts`)
const { DiagnosticsCollector } = await import(`${rootSrc}/import/diagnostics.ts`)
const { parseTikz } = await import(`${rootSrc}/import/tikzParser.ts`)

let passes = 0
let failures = 0
function assert(cond, label, detail) {
	if (cond) { passes++; return }
	failures++
	console.error(`  ✗ ${label}`)
	if (detail !== undefined) console.error("    " + detail)
}
function summary(title) { console.log(`\n=== ${title} ===`) }

// Cheap PRNG so the stress run is deterministic across machines.
function makeRng(seed) {
	let s = seed
	return () => {
		s = (s * 16807) % 2147483647
		return (s % 10000) / 10000
	}
}

summary("Stress: 100 randomised single-segment splines")
{
	const rng = makeRng(31415)
	let warnings = 0
	for (let i = 0; i < 100; i++) {
		const x0 = (rng() * 10).toFixed(2)
		const y0 = (rng() * 10).toFixed(2)
		const x1 = (rng() * 10).toFixed(2)
		const y1 = (rng() * 10).toFixed(2)
		const cx1 = (rng() * 10).toFixed(2)
		const cy1 = (rng() * 10).toFixed(2)
		const cx2 = (rng() * 10).toFixed(2)
		const cy2 = (rng() * 10).toFixed(2)
		const src = `\\draw (${x0},${y0}) .. controls (${cx1},${cy1}) and (${cx2},${cy2}) .. (${x1},${y1});`
		const collector = new DiagnosticsCollector(src)
		const doc = parseTikz(src, collector)
		const draw = doc.statements.find((s) => s.kind === "draw")
		const ctrls = draw?.elements?.filter((e) => e.kind === "controls") ?? []
		if (ctrls.length !== 1) {
			console.error(`    iter ${i}: ctrls=${ctrls.length}, src=${src}`)
		}
		warnings += collector.all().filter((d) => d.severity === "warning").length
	}
	assert(warnings === 0, "100 randomised single-segment splines parse cleanly", `total warnings: ${warnings}`)
}

summary("Stress: 50 deeply chained splines (10 segments each)")
{
	const rng = makeRng(99173)
	for (let i = 0; i < 50; i++) {
		let src = "\\draw (0,0)"
		for (let s = 1; s <= 10; s++) {
			const cx1 = (s - 0.5 + rng() * 0.2).toFixed(3)
			const cy1 = (rng() * 2 - 1).toFixed(3)
			const cx2 = (s - 0.3 + rng() * 0.2).toFixed(3)
			const cy2 = (rng() * 2 - 1).toFixed(3)
			src += ` .. controls (${cx1},${cy1}) and (${cx2},${cy2}) .. (${s},0)`
		}
		src += ";"
		const collector = new DiagnosticsCollector(src)
		const doc = parseTikz(src, collector)
		const draw = doc.statements.find((s) => s.kind === "draw")
		const ctrls = draw?.elements?.filter((e) => e.kind === "controls") ?? []
		if (ctrls.length !== 10) {
			console.error(`    iter ${i}: only ${ctrls.length}/10 segments parsed`)
		}
		const errs = collector.all().filter((d) => d.severity === "error")
		if (errs.length) {
			console.error(`    iter ${i}: errors=${JSON.stringify(errs)}`)
		}
	}
	assert(true, "50×10-segment chains parse without error")
}

summary("Stress: malformed segments degrade gracefully - no crashes")
{
	const fixtures = [
		"\\draw (0,0) .. (3,0);",                                  // missing controls
		"\\draw (0,0) .. controls (3,0);",                         // missing 2nd control
		"\\draw (0,0) .. controls (1,2) and  .. (3,0);",            // empty 2nd control
		"\\draw (0,0) .. controls (1,2) (2,2) (3,0);",              // missing 'and' AND trailing ..
		"\\draw (0,0) .. controls (1,2) and (2,2) (3,0);",          // missing trailing ..
		"\\draw (0,0) .. controls and (2,2) .. (3,0);",             // missing first control
		"\\draw .. controls (1,2) and (2,2) .. (3,0);",             // missing head coordinate
	]
	let crashes = 0
	for (const src of fixtures) {
		try {
			const collector = new DiagnosticsCollector(src)
			parseTikz(src, collector)
		} catch (e) {
			crashes++
			console.error(`    crash on: ${src} - ${e.message}`)
		}
	}
	assert(crashes === 0, "All 7 malformed fixtures recovered without crash", `crashes=${crashes}`)
}

summary("Stress: spline + path-symbol + wire mix")
{
	// Mixing a `to[R=…]`, a wire run, and a controls segment in one path. The transformer needs
	// to route each kind to the right component; the parser just needs to not lose anything.
	const src = `\\draw (0,0) -- (1,0) to[R=1k] (2,0) .. controls (2.5,1) and (3,1) .. (3.5,0) -- (4,0);`
	const collector = new DiagnosticsCollector(src)
	const doc = parseTikz(src, collector)
	const draw = doc.statements.find((s) => s.kind === "draw")
	const conns = draw.elements.filter((e) => e.kind === "connector")
	const tos = draw.elements.filter((e) => e.kind === "to")
	const ctrls = draw.elements.filter((e) => e.kind === "controls")
	assert(conns.length === 2, "Two plain connectors flank the special segments", `got ${conns.length}`)
	assert(tos.length === 1, "One to-clause", `got ${tos.length}`)
	assert(ctrls.length === 1, "One controls segment", `got ${ctrls.length}`)
}

summary("Stress: timing budget - 200-segment chain parses in <500ms")
{
	let src = "\\draw (0,0)"
	for (let s = 1; s <= 200; s++) {
		src += ` .. controls (${s - 0.5},1) and (${s - 0.3},-1) .. (${s},0)`
	}
	src += ";"
	const t0 = Date.now()
	const collector = new DiagnosticsCollector(src)
	const doc = parseTikz(src, collector)
	const elapsed = Date.now() - t0
	const draw = doc.statements.find((s) => s.kind === "draw")
	const ctrls = draw?.elements?.filter((e) => e.kind === "controls") ?? []
	assert(ctrls.length === 200, "200 segments parsed", `got ${ctrls.length}`)
	assert(elapsed < 500, "Stress chain parses under 500ms", `took ${elapsed}ms`)
}

console.log(`\n${passes} passed, ${failures} failed`)
if (failures > 0) process.exit(1)
