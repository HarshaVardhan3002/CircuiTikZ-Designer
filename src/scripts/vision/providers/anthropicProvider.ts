// src/scripts/vision/providers/anthropicProvider.ts
import type {
	CircuitVisionProvider, DetectionInput, ProviderConfig, ValidationResult,
} from "../visionProvider"
import type { DetectionResult } from "../detectionTypes"
import { detectionSchema } from "../prompts/detectionSchema"
import { buildPrompt } from "../prompts/detectionPrompt"
import { VisionError, type VisionErrorKind } from "../visionError"
import { validateDetectionShape } from "./openaiCompatProvider"

const DEFAULT_BASE_URL = "https://api.anthropic.com"

export const anthropicProvider: CircuitVisionProvider = {
	id: "anthropic",
	displayName: "Anthropic Claude",

	validateConfig(c: ProviderConfig): ValidationResult {
		const errors: string[] = []
		if (!c.apiKey) errors.push("API key required.")
		if (!c.model)  errors.push("Model name required (e.g. claude-sonnet-4-6).")
		return { ok: errors.length === 0, errors }
	},

	async detect(input: DetectionInput, c: ProviderConfig, signal?: AbortSignal): Promise<DetectionResult> {
		const url = `${c.baseUrl ?? DEFAULT_BASE_URL}/v1/messages`
		const { systemMessage, userInstructions } = buildPrompt({
			vocabulary: input.vocabulary,
			imageWidth: input.imageWidth,
			imageHeight: input.imageHeight,
			systemPromptOverride: c.systemPromptOverride,
		})

		const base64 = await blobToBase64(input.imageBlob)

		const body = {
			model: c.model,
			max_tokens: c.maxOutputTokens ?? 4096,
			temperature: c.temperature ?? 0,
			system: systemMessage,
			tools: [
				{
					name: "submit_circuit",
					description: "Submit the detected circuit as structured data.",
					input_schema: detectionSchema,
				},
			],
			tool_choice: { type: "tool" as const, name: "submit_circuit" },
			messages: [
				{
					role: "user",
					content: [
						{
							type: "image",
							source: { type: "base64", media_type: input.imageMimeType, data: base64 },
						},
						{ type: "text", text: userInstructions },
					],
				},
			],
		}

		let res: Response
		try {
			res = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": c.apiKey,
					"anthropic-version": "2023-06-01",
					// Required for direct browser calls.
					"anthropic-dangerous-direct-browser-access": "true",
				},
				body: JSON.stringify(body),
				signal,
			})
		} catch (e) {
			if ((e as Error).name === "AbortError") {
				throw new VisionError("cancelled", "Detection was cancelled.", { providerId: this.id })
			}
			throw new VisionError("network", `Network error: ${(e as Error).message}`, {
				providerId: this.id, cause: e,
			})
		}

		if (!res.ok) {
			const text = await res.text().catch(() => "")
			throw new VisionError(mapStatus(res.status), `HTTP ${res.status} ${text}`, {
				providerId: this.id, httpStatus: res.status,
			})
		}

		const json = await res.json() as { content: Array<{ type: string; name?: string; input?: unknown }> }
		const tu = (json.content ?? []).find((b) => b.type === "tool_use" && b.name === "submit_circuit")
		if (!tu) {
			throw new VisionError("schema", "Claude did not call submit_circuit.", { providerId: this.id })
		}
		return validateDetectionShape(tu.input, this.id)
	},
}

function mapStatus(s: number): VisionErrorKind {
	if (s === 401 || s === 403) return "auth"
	if (s === 429) return "rate-limit"
	if (s >= 400 && s < 500) return "bad-request"
	return "network"
}

async function blobToBase64(blob: Blob): Promise<string> {
	if (typeof FileReader !== "undefined") {
		return await new Promise<string>((resolve, reject) => {
			const fr = new FileReader()
			fr.onload = () => {
				const r = fr.result as string
				// strip the "data:<mime>;base64," prefix
				resolve(r.slice(r.indexOf(",") + 1))
			}
			fr.onerror = () => reject(fr.error)
			fr.readAsDataURL(blob)
		})
	}
	return Buffer.from(await blob.arrayBuffer()).toString("base64")
}
