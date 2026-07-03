// tests/vision/openai-compat.test.mjs
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = pathToFileURL(path.resolve(here, "../../src/scripts")).href

const { buildVocabularyFromEntries } =
	await import(`${root}/vision/prompts/componentVocabulary.ts`)
const { openaiCompatProvider } =
	await import(`${root}/vision/providers/openaiCompatProvider.ts`)

let passes = 0, failures = 0
const assert = (c, l, d) => { if (c) passes++; else { failures++; console.error(`  ✗ ${l}`); if (d) console.error("    " + d) } }

// Mock fetch.
let lastRequest = null
function makeFetch(responseBody, status = 200) {
	return async (url, init) => {
		lastRequest = { url, init }
		return {
			ok: status >= 200 && status < 300,
			status,
			async text() { return JSON.stringify(responseBody) },
			async json() { return responseBody },
		}
	}
}

const v = buildVocabularyFromEntries([
	{ key: "resistor", description: "R", pins: ["a","b"], internalType: "resistor" },
])

const ok = {
	choices: [{
		message: {
			content: JSON.stringify({
				components: [{ id: "C1", type: "resistor", x: 50, y: 50, rotation: 0, confidence: 0.9 }],
				wires: [],
				warnings: [],
			}),
		},
	}],
}

export async function run() {
	console.log("\n=== vision: openai-compat provider ===")

	// ---- happy path -------------------------------------------------------------------
	globalThis.fetch = makeFetch(ok)
	const blob = new Blob([new Uint8Array([1,2,3])], { type: "image/png" })
	const result = await openaiCompatProvider.detect(
		{
			imageBlob: blob,
			imageMimeType: "image/png",
			imageWidth: 200,
			imageHeight: 200,
			vocabulary: v,
		},
		{
			providerId: "openai-compat",
			apiKey: "sk-test",
			model: "gpt-4o",
		},
	)

	assert(result.components.length === 1, "parses one component from response")
	assert(result.components[0].confidence === 0.9, "confidence preserved")

	// Request shape.
	const body = JSON.parse(lastRequest.init.body)
	assert(body.model === "gpt-4o", "model in body")
	assert(Array.isArray(body.messages), "messages array")
	const userMsg = body.messages.find((m) => m.role === "user")
	assert(Array.isArray(userMsg.content), "user message content is multipart")
	assert(userMsg.content.some((c) => c.type === "image_url"), "user message has image_url")
	assert(lastRequest.init.headers["Authorization"] === "Bearer sk-test", "Bearer auth header")

	// ---- 401 → VisionError kind=auth ----------------------------------------------------
	globalThis.fetch = makeFetch({ error: { message: "bad key" } }, 401)
	let err = null
	try {
		await openaiCompatProvider.detect(
			{ imageBlob: blob, imageMimeType: "image/png", imageWidth: 100, imageHeight: 100, vocabulary: v },
			{ providerId: "openai-compat", apiKey: "sk-bad", model: "gpt-4o" },
		)
	} catch (e) { err = e }
	assert(err?.kind === "auth", "401 maps to kind=auth")

	// ---- malformed JSON → kind=schema (after one retry, but we only mock one response) -
	globalThis.fetch = makeFetch({ choices: [{ message: { content: "not json" } }] }, 200)
	err = null
	try {
		await openaiCompatProvider.detect(
			{ imageBlob: blob, imageMimeType: "image/png", imageWidth: 100, imageHeight: 100, vocabulary: v },
			{ providerId: "openai-compat", apiKey: "sk", model: "gpt-4o" },
		)
	} catch (e) { err = e }
	assert(err?.kind === "schema", "non-JSON response maps to kind=schema")

	return { passes, failures }
}
