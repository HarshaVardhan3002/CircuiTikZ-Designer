// tests/vision/storage.test.mjs
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"

// Provide a localStorage stub before importing the module under test.
const memory = new Map()
globalThis.localStorage = {
	getItem: (k) => (memory.has(k) ? memory.get(k) : null),
	setItem: (k, v) => memory.set(k, String(v)),
	removeItem: (k) => memory.delete(k),
	clear: () => memory.clear(),
}

const here = path.dirname(fileURLToPath(import.meta.url))
const root = pathToFileURL(path.resolve(here, "../../src/scripts")).href
const storage = await import(`${root}/vision/storage/providerStorage.ts`)

let passes = 0, failures = 0
const assert = (c, l, d) => { if (c) passes++; else { failures++; console.error(`  ✗ ${l}`); if (d) console.error("    " + d) } }

export async function run() {
	console.log("\n=== vision: provider storage ===")

	memory.clear()

	// Empty state.
	assert(storage.getActiveProviderId() === null, "no active provider initially")

	storage.setActiveProviderId("anthropic")
	assert(storage.getActiveProviderId() === "anthropic", "active provider round-trips")

	// Per-provider config.
	const cfg = { providerId: "anthropic", apiKey: "sk-test", model: "claude-sonnet-4-6" }
	storage.saveProviderConfig(cfg)
	const got = storage.loadProviderConfig("anthropic")
	assert(got?.apiKey === "sk-test", "config round-trips")
	assert(got?.model === "claude-sonnet-4-6", "model preserved")

	// Missing returns null.
	assert(storage.loadProviderConfig("never-stored") === null, "missing config returns null")

	// Corruption returns null + clears the bad key (defensive).
	memory.set("circuitvision.providers.gemini", "{ not json")
	assert(storage.loadProviderConfig("gemini") === null, "corrupted JSON returns null")

	return { passes, failures }
}
