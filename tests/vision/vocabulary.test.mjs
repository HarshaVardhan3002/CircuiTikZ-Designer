// tests/vision/vocabulary.test.mjs
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = pathToFileURL(path.resolve(here, "../../src/scripts")).href
const { buildVocabularyFromEntries, formatVocabularyForPrompt } =
	await import(`${root}/vision/prompts/componentVocabulary.ts`)

let passes = 0, failures = 0
const assert = (c, label, detail) => {
	if (c) passes++
	else { failures++; console.error(`  ✗ ${label}`); if (detail) console.error("    " + detail) }
}

export async function run() {
	console.log("\n=== vision: vocabulary ===")

	const entries = [
		{ key: "resistor",  description: "Two-terminal resistor", pins: ["a", "b"], internalType: "Resistor" },
		{ key: "capacitor", description: "Two-terminal capacitor", pins: ["a", "b"], internalType: "Capacitor" },
	]

	const v = buildVocabularyFromEntries(entries)
	assert(v.entries.length === 2, "vocabulary keeps both entries")
	assert(v.entries[0].key === "resistor", "first entry key preserved")

	const promptStr = formatVocabularyForPrompt(v)
	assert(promptStr.includes("resistor"), "prompt mentions resistor")
	assert(promptStr.includes("a, b"), "prompt mentions pin names")

	// Reject duplicate keys.
	let threw = false
	try {
		buildVocabularyFromEntries([
			{ key: "x", description: "", pins: [], internalType: "X" },
			{ key: "x", description: "", pins: [], internalType: "Y" },
		])
	} catch { threw = true }
	assert(threw, "duplicate key throws")

	return { passes, failures }
}
