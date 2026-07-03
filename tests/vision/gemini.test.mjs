// tests/vision/gemini.test.mjs
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = pathToFileURL(path.resolve(here, "../../src/scripts")).href

const { buildVocabularyFromEntries } =
	await import(`${root}/vision/prompts/componentVocabulary.ts`)
const { geminiProvider } =
	await import(`${root}/vision/providers/geminiProvider.ts`)

let passes = 0, failures = 0
const assert = (c, l, d) => { if (c) passes++; else { failures++; console.error(`  ✗ ${l}`); if (d) console.error("    " + d) } }

let lastReq = null
function fakeFetch(body, status = 200) {
	return async (url, init) => {
		lastReq = { url, init }
		return {
			ok: status >= 200 && status < 300,
			status,
			async json() { return body },
			async text() { return JSON.stringify(body) },
		}
	}
}

const v = buildVocabularyFromEntries([
	{ key: "resistor", description: "R", pins: ["a","b"], internalType: "resistor" },
])

const ok = {
	candidates: [{
		content: {
			parts: [{
				text: JSON.stringify({
					components: [{ id: "C1", type: "resistor", x: 50, y: 50, rotation: 0, confidence: 0.93 }],
					wires: [],
					warnings: [],
				}),
			}],
		},
	}],
}

export async function run() {
	console.log("\n=== vision: gemini provider ===")

	globalThis.fetch = fakeFetch(ok)
	const blob = new Blob([new Uint8Array([1,2,3])], { type: "image/png" })
	const result = await geminiProvider.detect(
		{ imageBlob: blob, imageMimeType: "image/png", imageWidth: 100, imageHeight: 100, vocabulary: v },
		{ providerId: "gemini", apiKey: "AIza-test", model: "gemini-2.5-flash" },
	)
	assert(result.components.length === 1, "parsed one component from text part")
	assert(lastReq.url.includes("gemini-2.5-flash:generateContent"), "model in URL")
	assert(lastReq.url.includes("key=AIza-test"), "key in URL query string")
	const body = JSON.parse(lastReq.init.body)
	assert(body.contents[0].parts.some((p) => p.inline_data), "inline_data attached")
	assert(body.generationConfig?.responseMimeType === "application/json",
		"response mime forced to JSON")

	return { passes, failures }
}
