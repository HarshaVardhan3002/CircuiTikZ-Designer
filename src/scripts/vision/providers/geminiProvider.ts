// src/scripts/vision/providers/geminiProvider.ts
import type {
	CircuitVisionProvider, DetectionInput, ProviderConfig, ValidationResult,
} from "../visionProvider"
import type { DetectionResult } from "../detectionTypes"
import { detectionSchema } from "../prompts/detectionSchema"
import { buildPrompt } from "../prompts/detectionPrompt"
import { VisionError, type VisionErrorKind } from "../visionError"
import { validateDetectionShape } from "./openaiCompatProvider"

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com"

export const geminiProvider: CircuitVisionProvider = {
	id: "gemini",
	displayName: "Google Gemini",

	validateConfig(c: ProviderConfig): ValidationResult {
		const errors: string[] = []
		if (!c.apiKey) errors.push("API key required.")
		if (!c.model)  errors.push("Model name required (e.g. gemini-2.5-flash).")
		return { ok: errors.length === 0, errors }
	},

	async detect(input: DetectionInput, c: ProviderConfig, signal?: AbortSignal): Promise<DetectionResult> {
		const url = `${c.baseUrl ?? DEFAULT_BASE_URL}/v1beta/models/${encodeURIComponent(c.model)}:generateContent?key=${encodeURIComponent(c.apiKey)}`
		const { systemMessage, userInstructions } = buildPrompt({
			vocabulary: input.vocabulary,
			imageWidth: input.imageWidth,
			imageHeight: input.imageHeight,
			systemPromptOverride: c.systemPromptOverride,
		})
		const base64 = await blobToBase64(input.imageBlob)

		const body = {
			systemInstruction: { role: "system", parts: [{ text: systemMessage }] },
			contents: [
				{
					role: "user",
					parts: [
						{ text: userInstructions },
						{ inline_data: { mime_type: input.imageMimeType, data: base64 } },
					],
				},
			],
			generationConfig: {
				temperature: c.temperature ?? 0,
				maxOutputTokens: c.maxOutputTokens ?? 4096,
				responseMimeType: "application/json",
				responseSchema: detectionSchema,
			},
		}

		let res: Response
		try {
			res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
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

		const json = await res.json() as {
			candidates?: { content?: { parts?: { text?: string }[] } }[]
		}
		const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
		if (!text) {
			throw new VisionError("schema", "Empty response from Gemini.", { providerId: this.id })
		}
		let parsed: unknown
		try { parsed = JSON.parse(text) }
		catch (e) {
			throw new VisionError("schema", `Gemini response was not JSON: ${(e as Error).message}`, {
				providerId: this.id, cause: e,
			})
		}
		return validateDetectionShape(parsed, this.id)
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
				resolve(r.slice(r.indexOf(",") + 1))
			}
			fr.onerror = () => reject(fr.error)
			fr.readAsDataURL(blob)
		})
	}
	return Buffer.from(await blob.arrayBuffer()).toString("base64")
}
