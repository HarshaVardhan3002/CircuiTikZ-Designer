// src/scripts/vision/providers/openaiCompatProvider.ts
import type {
	CircuitVisionProvider, DetectionInput, ProviderConfig, ValidationResult,
} from "../visionProvider"
import type { DetectionResult } from "../detectionTypes"
import { detectionSchema } from "../prompts/detectionSchema"
import { buildPrompt } from "../prompts/detectionPrompt"
import { VisionError, type VisionErrorKind } from "../visionError"

const DEFAULT_BASE_URL = "https://api.openai.com/v1"

export const openaiCompatProvider: CircuitVisionProvider = {
	id: "openai-compat",
	displayName: "OpenAI-compatible (OpenAI / Ollama / LM Studio / vLLM / …)",

	validateConfig(c: ProviderConfig): ValidationResult {
		const errors: string[] = []
		if (!c.apiKey) errors.push("API key is required (some local servers accept any non-empty value).")
		if (!c.model) errors.push("Model name is required.")
		if (c.baseUrl && !/^https?:\/\//.test(c.baseUrl)) errors.push("Base URL must start with http:// or https://")
		return { ok: errors.length === 0, errors }
	},

	async testConnection(c: ProviderConfig, signal?: AbortSignal): Promise<ValidationResult> {
		try {
			const res = await fetch(`${c.baseUrl ?? DEFAULT_BASE_URL}/models`, {
				method: "GET",
				headers: { Authorization: `Bearer ${c.apiKey}` },
				signal,
			})
			if (res.ok) return { ok: true, errors: [] }
			if (res.status === 404) {
				// Many local servers don't expose /models. Treat as soft-success so testConnection
				// doesn't false-negative on Ollama / LM Studio.
				return { ok: true, errors: [] }
			}
			return { ok: false, errors: [`HTTP ${res.status} from ${c.baseUrl ?? DEFAULT_BASE_URL}/models`] }
		} catch (e) {
			return { ok: false, errors: [String((e as Error).message ?? e)] }
		}
	},

	async detect(input: DetectionInput, c: ProviderConfig, signal?: AbortSignal): Promise<DetectionResult> {
		const url = `${c.baseUrl ?? DEFAULT_BASE_URL}/chat/completions`
		const { systemMessage, userInstructions } = buildPrompt({
			vocabulary: input.vocabulary,
			imageWidth: input.imageWidth,
			imageHeight: input.imageHeight,
			systemPromptOverride: c.systemPromptOverride,
		})
		const dataUrl = await blobToDataUrl(input.imageBlob)

		const messages = [
			{ role: "system", content: systemMessage },
			{
				role: "user",
				content: [
					{ type: "text", text: userInstructions },
					{ type: "image_url", image_url: { url: dataUrl } },
				],
			},
		]
		const baseBody = {
			model: c.model,
			temperature: c.temperature ?? 0,
			max_tokens: c.maxOutputTokens ?? 4096,
			messages,
		}

		const post = async (reqBody: object): Promise<Response> => {
			try {
				return await fetch(url, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${c.apiKey}`,
					},
					body: JSON.stringify(reqBody),
					signal,
				})
			} catch (e) {
				if ((e as Error).name === "AbortError") {
					throw new VisionError("cancelled", "Detection was cancelled.", { providerId: this.id })
				}
				throw new VisionError("network", `Network error contacting ${url}: ${(e as Error).message}`, {
					providerId: this.id, cause: e,
				})
			}
		}

		// Prefer strict structured output (OpenAI / vLLM). Many local or proxy OpenAI-compatible
		// endpoints reject `json_schema`; degrade to `json_object`, then to a plain prompt-only
		// request, so a custom endpoint still works instead of hard-failing on a 400/422.
		let res = await post({
			...baseBody,
			response_format: {
				type: "json_schema" as const,
				json_schema: { name: "circuit", strict: true, schema: detectionSchema },
			},
		})
		if (!res.ok && (res.status === 400 || res.status === 422)) {
			res = await post({ ...baseBody, response_format: { type: "json_object" as const } })
		}
		if (!res.ok && (res.status === 400 || res.status === 422)) {
			res = await post(baseBody)
		}

		if (!res.ok) {
			const kind = mapStatus(res.status)
			const text = await res.text().catch(() => "")
			throw new VisionError(kind, `HTTP ${res.status} ${text}`, {
				providerId: this.id, httpStatus: res.status,
			})
		}

		const json = await res.json() as {
			choices: { message: { content: string } }[]
		}
		const content = json?.choices?.[0]?.message?.content ?? ""
		return parseDetectionPayload(content, this.id)
	},
}

function mapStatus(s: number): VisionErrorKind {
	if (s === 401 || s === 403) return "auth"
	if (s === 429) return "rate-limit"
	if (s >= 400 && s < 500) return "bad-request"
	return "network"
}

async function blobToDataUrl(blob: Blob): Promise<string> {
	if (typeof FileReader !== "undefined") {
		return await new Promise((resolve, reject) => {
			const fr = new FileReader()
			fr.onload = () => resolve(fr.result as string)
			fr.onerror = () => reject(fr.error)
			fr.readAsDataURL(blob)
		})
	}
	// Node fallback for tests.
	const buf = Buffer.from(await blob.arrayBuffer())
	return `data:${blob.type || "application/octet-stream"};base64,${buf.toString("base64")}`
}

export function parseDetectionPayload(text: string, providerId: string): DetectionResult {
	// Tolerate endpoints that can't enforce a JSON schema: strip ```json ... ``` fences and, if the
	// model added prose around the object, fall back to the first {...} block before parsing.
	let cleaned = text.trim()
	const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i)
	if (fence) cleaned = fence[1].trim()
	let parsed: unknown
	try {
		parsed = JSON.parse(cleaned)
	} catch {
		const braced = cleaned.match(/\{[\s\S]*\}/)
		if (!braced) {
			throw new VisionError("schema", "Provider response was not valid JSON.", { providerId })
		}
		try {
			parsed = JSON.parse(braced[0])
		} catch (e) {
			throw new VisionError("schema", `Provider response was not valid JSON: ${(e as Error).message}`, {
				providerId, cause: e,
			})
		}
	}
	return validateDetectionShape(parsed, providerId)
}

export function validateDetectionShape(obj: unknown, providerId: string): DetectionResult {
	if (!obj || typeof obj !== "object") {
		throw new VisionError("schema", "Response is not an object.", { providerId })
	}
	const o = obj as Record<string, unknown>
	const components = Array.isArray(o.components) ? o.components : null
	const wires = Array.isArray(o.wires) ? o.wires : null
	const warnings = Array.isArray(o.warnings) ? o.warnings : []
	if (!components || !wires) {
		throw new VisionError("schema", "Response missing required arrays (components, wires).", { providerId })
	}
	for (const c of components) {
		const x = (c as { x?: unknown })?.x, y = (c as { y?: unknown })?.y
		const conf = (c as { confidence?: unknown })?.confidence
		if (typeof (c as { id?: unknown })?.id !== "string") {
			throw new VisionError("schema", "component.id missing", { providerId })
		}
		if (typeof (c as { type?: unknown })?.type !== "string") {
			throw new VisionError("schema", "component.type missing", { providerId })
		}
		if (typeof x !== "number" || typeof y !== "number") {
			throw new VisionError("schema", `component "${(c as { id: string }).id}" missing numeric x/y`, { providerId })
		}
		if (typeof conf !== "number" || conf < 0 || conf > 1) {
			throw new VisionError("schema", `component "${(c as { id: string }).id}" confidence out of range`, { providerId })
		}
	}
	return {
		components: components as DetectionResult["components"],
		wires: wires as DetectionResult["wires"],
		warnings: warnings.filter((w: unknown): w is string => typeof w === "string"),
		imageBoundsHint: (o.imageBoundsHint as DetectionResult["imageBoundsHint"]) ?? undefined,
	}
}
