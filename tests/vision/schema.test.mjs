// tests/vision/schema.test.mjs
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = pathToFileURL(path.resolve(here, "../../src/scripts")).href
const { detectionSchema } = await import(`${root}/vision/prompts/detectionSchema.ts`)

let passes = 0, failures = 0
const assert = (c, l) => { if (c) passes++; else { failures++; console.error(`  ✗ ${l}`) } }

export async function run() {
	console.log("\n=== vision: detection schema ===")

	assert(detectionSchema.type === "object", "root is an object schema")
	assert(detectionSchema.required.includes("components"), "components is required")
	assert(detectionSchema.required.includes("wires"), "wires is required")

	const c = detectionSchema.properties.components.items
	assert(c.type === "object", "component item is an object")
	assert(c.required.includes("id") && c.required.includes("type"), "component id+type required")
	assert(c.properties.confidence.type === "number", "confidence is a number")
	assert(c.properties.confidence.minimum === 0, "confidence min 0")
	assert(c.properties.confidence.maximum === 1, "confidence max 1")

	const w = detectionSchema.properties.wires.items
	assert(w.required.includes("from"), "wire from required")
	assert(w.required.includes("to"), "wire to required")
	assert(w.properties.from.required.includes("componentId"), "wire.from.componentId required")

	return { passes, failures }
}
