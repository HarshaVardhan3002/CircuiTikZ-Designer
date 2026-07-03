// tests/vision/mapper.test.mjs
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = pathToFileURL(path.resolve(here, "../../src/scripts")).href

const { DiagnosticsCollector } = await import(`${root}/import/diagnostics.ts`)
const { buildVocabularyFromEntries } = await import(`${root}/vision/prompts/componentVocabulary.ts`)
const { mapDetectionResult } = await import(`${root}/vision/pipeline/detectionResultMapper.ts`)

let passes = 0, failures = 0
const assert = (c, l, d) => { if (c) passes++; else { failures++; console.error(`  ✗ ${l}`); if (d) console.error("    " + d) } }

export async function run() {
	console.log("\n=== vision: detection-result mapper ===")

	const v = buildVocabularyFromEntries([
		{ key: "resistor",  description: "R", pins: ["a","b"], internalType: "resistor" },
		{ key: "capacitor", description: "C", pins: ["a","b"], internalType: "capacitor" },
	])

	const detection = {
		components: [
			{ id: "C1", type: "resistor",  x: 100, y: 100, rotation:  0, confidence: 0.95 },
			{ id: "C2", type: "capacitor", x: 200, y: 100, rotation: 90, confidence: 0.62 },
			{ id: "C3", type: "mystery",   x: 300, y: 100, rotation:  0, confidence: 0.4  },
		],
		wires: [
			{ from: { componentId: "C1", pin: "b" }, to: { componentId: "C2", pin: "a" }, confidence: 0.9 },
			{ from: { componentId: "C9", pin: "x" }, to: { componentId: "C2", pin: "b" }, confidence: 0.7 }, // dangling
		],
		warnings: ["partially obscured component near top-right"],
		imageBoundsHint: { width: 800, height: 600 },
	}

	// Stub resolver: knows that "resistor" is a path-symbol, "capacitor" is a path-symbol.
	// Anything else (including the "mystery" / "unknown" placeholders) returns null and the
	// mapper defaults the wrap-type to "node".
	const resolver = (tikzName) =>
		tikzName === "resistor" || tikzName === "capacitor" ? "path" : null

	const result = mapDetectionResult(detection, v, new DiagnosticsCollector(""), resolver)
	assert(result.format === "image", "format is image")
	assert(result.success === true, "success true (we have ≥1 component, no hard errors)")

	const componentSaves = result.components.filter((c) => c.type !== "wire")
	assert(componentSaves.length === 3, "all three components produced (unknown is placeholder)",
		`got ${componentSaves.length}`)

	// New save-shape contract: symbol-backed components are wrapped as
	// {type: "node"|"path", id: <tikzName>, position, rotation}; jsonID is no longer the tikzName.
	const r1 = componentSaves[0]
	assert(r1.type === "path" && r1.id === "resistor", "resistor wrapped as path-symbol",
		`got type=${r1.type}, id=${r1.id}`)
	const c1 = componentSaves[1]
	assert(c1.type === "path" && c1.id === "capacitor", "capacitor wrapped as path-symbol")
	const unknown = componentSaves[2]
	assert(unknown.type === "node" && unknown.id === "unknown",
		"unknown-type fallback is a node-symbol with id='unknown'",
		`got type=${unknown.type}, id=${unknown.id}`)

	// Diagnostics: 1 info per low-confidence component, 1 warning for dropped wire,
	// 1 warning for unknown type, 1 info for the model warning.
	const infos    = result.diagnostics.filter((d) => d.severity === "info")
	const warnings = result.diagnostics.filter((d) => d.severity === "warning")
	assert(warnings.some((d) => d.code === "vision-unknown-type"), "diagnostic for unknown type")
	assert(warnings.some((d) => d.code === "vision-wire-dangling"), "diagnostic for dropped wire")
	assert(infos.some((d) => d.code === "vision-low-confidence"), "diagnostic for low-confidence components")
	assert(infos.some((d) => d.message.includes("partially obscured")),
		"model warnings forwarded as info")

	// Wires: only the resolvable one survives, with proper points + directions.
	const wireSaves = result.components.filter((c) => c.type === "wire")
	assert(wireSaves.length === 1, "one wire produced (dangling dropped)")
	const wire = wireSaves[0]
	assert(Array.isArray(wire.points) && wire.points.length === 2, "wire has 2 endpoints")
	assert(Array.isArray(wire.directions) && wire.directions.length === 1,
		"wire has 1 direction segment")
	assert(wire.directions[0] === "--", "wire direction is straight")
	// Endpoints come from C1 (100,100) and C2 (200,100).
	assert(wire.points[0].x === 100 && wire.points[0].y === 100, "wire from-point is C1's center")
	assert(wire.points[1].x === 200 && wire.points[1].y === 100, "wire to-point is C2's center")

	return { passes, failures }
}
