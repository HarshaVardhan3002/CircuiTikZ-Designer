// tests/vision/preprocessor.test.mjs
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = pathToFileURL(path.resolve(here, "../../src/scripts")).href
const { computeTargetDimensions } = await import(`${root}/vision/pipeline/imagePreprocessor.ts`)

let passes = 0, failures = 0
const assert = (c, l, d) => { if (c) passes++; else { failures++; console.error(`  ✗ ${l}`); if (d) console.error("    " + d) } }

export async function run() {
	console.log("\n=== vision: preprocessor (pure math) ===")

	// Smaller-than-cap → unchanged.
	let r = computeTargetDimensions(800, 600, 2048)
	assert(r.width === 800 && r.height === 600, "small image unchanged", JSON.stringify(r))

	// Wide → scale by long edge.
	r = computeTargetDimensions(4096, 2048, 2048)
	assert(r.width === 2048 && r.height === 1024, "wide image scaled to 2048 × 1024", JSON.stringify(r))

	// Tall → scale by long edge.
	r = computeTargetDimensions(1000, 4000, 2048)
	assert(r.width === 512 && r.height === 2048, "tall image scaled to 512 × 2048", JSON.stringify(r))

	// Square at cap → unchanged.
	r = computeTargetDimensions(2048, 2048, 2048)
	assert(r.width === 2048 && r.height === 2048, "square at cap unchanged")

	// Always integer.
	r = computeTargetDimensions(3001, 1999, 2048)
	assert(Number.isInteger(r.width) && Number.isInteger(r.height), "result dimensions are integers")

	return { passes, failures }
}
