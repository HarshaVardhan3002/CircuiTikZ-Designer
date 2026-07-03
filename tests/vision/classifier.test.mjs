// tests/vision/classifier.test.mjs
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = pathToFileURL(path.resolve(here, "../../src/scripts")).href
const { classifyConfidence, DEFAULT_THRESHOLDS } =
	await import(`${root}/vision/pipeline/confidenceClassifier.ts`)

let passes = 0, failures = 0
const assert = (c, l, d) => { if (c) passes++; else { failures++; console.error(`  ✗ ${l}`); if (d) console.error("    " + d) } }

export async function run() {
	console.log("\n=== vision: confidence classifier ===")

	const t = DEFAULT_THRESHOLDS
	assert(t.medium === 0.7, "medium threshold default 0.7")
	assert(t.high === 0.85, "high threshold default 0.85")

	assert(classifyConfidence(0.95, t) === "high", "0.95 → high")
	assert(classifyConfidence(0.85, t) === "high", "0.85 boundary → high (≥)")
	assert(classifyConfidence(0.84, t) === "medium", "0.84 → medium")
	assert(classifyConfidence(0.7, t) === "medium", "0.7 boundary → medium (≥)")
	assert(classifyConfidence(0.69, t) === "low", "0.69 → low")
	assert(classifyConfidence(0, t) === "low", "0 → low")
	assert(classifyConfidence(1, t) === "high", "1 → high")

	return { passes, failures }
}
