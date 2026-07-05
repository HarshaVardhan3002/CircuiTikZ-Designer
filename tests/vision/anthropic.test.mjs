// tests/vision/anthropic.test.mjs
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = pathToFileURL(path.resolve(here, "../../src/scripts")).href

const { buildVocabularyFromEntries } =
	await import(`${root}/vision/prompts/componentVocabulary.ts`)
const { anthropicProvider } =
	await import(`${root}/vision/providers/anthropicProvider.ts`)

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
	content: [
		{ type: "text", text: "" },
		{
			type: "tool_use",
			name: "submit_circuit",
			input: {
				components: [{ id: "C1", type: "resistor", x: 50, y: 50, rotation: 0, confidence: 0.91 }],
				wires: [],
				warnings: [],
			},
		},
	],
}

export async function run() {
	console.log("\n=== vision: anthropic provider ===")

	globalThis.fetch = fakeFetch(ok)
	const blob = new Blob([new Uint8Array([1,2,3])], { type: "image/png" })
	const result = await anthropicProvider.detect(
		{ imageBlob: blob, imageMimeType: "image/png", imageWidth: 100, imageHeight: 100, vocabulary: v },
		{ providerId: "anthropic", apiKey: "sk-ant-test", model: "claude-sonnet-4-6" },
	)
	assert(result.components.length === 1, "parsed one component from tool_use")
	assert(lastReq.init.headers["x-api-key"] === "sk-ant-test", "x-api-key header set")
	assert(lastReq.init.headers["anthropic-version"] === "2023-06-01", "anthropic-version header set")

	const body = JSON.parse(lastReq.init.body)
	assert(body.tools?.[0]?.name === "submit_circuit", "submit_circuit tool registered")
	assert(body.tool_choice?.name === "submit_circuit", "tool_choice forces submit_circuit")
	const userMsg = body.messages.find((m) => m.role === "user")
	assert(Array.isArray(userMsg.content) && userMsg.content.some((c) => c.type === "image"),
		"user message has image content block")

	return { passes, failures }
}
