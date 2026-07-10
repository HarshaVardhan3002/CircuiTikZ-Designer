// src/scripts/import/aiRepair.ts
//
// AI-assisted import repair. When a TikZ / JSON paste fails to import cleanly, the user can ask the
// configured OpenAI-compatible model to fix the source and re-import it. Reuses the same provider
// config as the chat + vision features - the API key is optional, so a local Ollama / LM Studio /
// vLLM server (which needs no key) works out of the box.

import { getActiveProviderId, loadProviderConfig } from "../vision/storage/providerStorage"

/** True when an OpenAI-compatible provider is configured (model set; API key optional). */
export async function aiRepairAvailable(): Promise<boolean> {
	const id = getActiveProviderId()
	if (id !== "openai-compat") return false
	const cfg = await loadProviderConfig(id)
	return !!(cfg && cfg.model)
}

/**
 * Ask the configured model to repair failed import source. Returns the corrected TikZ / JSON text
 * with any markdown code fences stripped. Throws with a readable message on failure.
 *
 * @param source        the original text that failed to import
 * @param format        "json" is treated as a JSON save file; anything else as CircuiTikZ
 * @param errorSummary  a newline-joined list of the import errors, to focus the model
 * @param signal        optional AbortSignal to cancel the request
 */
export async function repairImportWithAI(
	source: string,
	format: string,
	errorSummary: string,
	signal?: AbortSignal
): Promise<string> {
	const id = getActiveProviderId()
	const cfg = id === "openai-compat" ? await loadProviderConfig(id) : null
	if (!cfg || !cfg.model) {
		throw new Error("No AI provider configured. Open Settings → AI Provider and set an endpoint + model.")
	}

	const url = (cfg.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "") + "/chat/completions"
	const isJson = format === "json"
	const system =
		isJson ?
			"You repair CircuiTikZ-Designer JSON save files so they import cleanly. Return ONLY the corrected JSON object - no prose, no markdown, no code fences."
		:	"You repair CircuiTikZ / TikZ circuit source so it imports cleanly. Return ONLY the corrected CircuiTikZ code - no prose, no markdown fences, and no \\documentclass or \\begin{document} wrapper. The \\begin{tikzpicture}…\\end{tikzpicture} body (or bare \\draw / \\node lines) is enough."
	const user =
		`This ${isJson ? "JSON" : "CircuiTikZ code"} failed to import into a circuit editor. Fix it so it parses and imports without errors, preserving the intended circuit. Do not invent components that were not implied by the source.\n\n` +
		`Import errors:\n${errorSummary || "(none reported)"}\n\nSource:\n${source}`

	const res = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(cfg.apiKey ? { Authorization: "Bearer " + cfg.apiKey } : {}),
		},
		body: JSON.stringify({
			model: cfg.model,
			temperature: 0,
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: user },
			],
		}),
		signal,
	})

	if (!res.ok) {
		const t = await res.text().catch(() => "")
		throw new Error("AI endpoint returned HTTP " + res.status + (t ? ": " + t.slice(0, 200) : ""))
	}

	const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
	let content = data?.choices?.[0]?.message?.content ?? ""
	if (!content.trim()) throw new Error("The AI returned an empty response.")

	// Strip ```lang … ``` fences if the model added them despite instructions.
	const fence = content.match(/```(?:json|latex|tikz|circuitikz)?\s*([\s\S]*?)```/i)
	if (fence) content = fence[1]
	return content.trim()
}
