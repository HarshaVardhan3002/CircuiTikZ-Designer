// tests/vision/prompt.test.mjs
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = pathToFileURL(path.resolve(here, "../../src/scripts")).href
const { buildPrompt } = await import(`${root}/vision/prompts/detectionPrompt.ts`)
const { buildVocabularyFromEntries } = await import(`${root}/vision/prompts/componentVocabulary.ts`)

let passes = 0, failures = 0
const assert = (c, l) => { if (c) passes++; else { failures++; console.error(`  ✗ ${l}`) } }

export async function run() {
	console.log("\n=== vision: prompt builder ===")
	const v = buildVocabularyFromEntries([
		{ key: "resistor", description: "Resistor", pins: ["a", "b"], internalType: "resistor" },
	])
	const { systemMessage, userInstructions } = buildPrompt({
		vocabulary: v,
		imageWidth: 800,
		imageHeight: 600,
	})

	assert(systemMessage.length > 50, "system message has substance")
	assert(userInstructions.includes("800"), "user instructions mention image width")
	assert(userInstructions.includes("resistor"), "user instructions list vocabulary")
	assert(userInstructions.includes("top-left origin"), "coordinate frame stated")

	return { passes, failures }
}
