// src/scripts/vision/prompts/detectionPrompt.ts
import { formatVocabularyForPrompt, type ComponentVocabulary } from "./componentVocabulary"

export interface PromptParameters {
	vocabulary: ComponentVocabulary
	imageWidth: number
	imageHeight: number
	/** Optional override; defaults to a tested system prompt. */
	systemPromptOverride?: string
}

const DEFAULT_SYSTEM = [
	"You are a circuit-diagram extraction system.",
	"You are given an image of a hand-drawn or printed circuit schematic.",
	"Identify the symbols and the wires connecting them, and return a strictly-formatted JSON",
	"object that conforms to the schema you have been given.",
	"Be conservative: only emit components you can clearly recognise; mark anything ambiguous",
	"with a confidence below 0.7 so the user can review it.",
	"Do not invent components that are not visible. Do not include explanatory prose.",
].join(" ")

export function buildPrompt(p: PromptParameters): { systemMessage: string; userInstructions: string } {
	const systemMessage = p.systemPromptOverride ?? DEFAULT_SYSTEM

	const vocab = formatVocabularyForPrompt(p.vocabulary)

	const userInstructions = [
		`The image is ${p.imageWidth} × ${p.imageHeight} pixels, top-left origin: x grows right, y grows down.`,
		"",
		"Allowed component types (use the key in 'type' verbatim; if a symbol clearly does not match any of these,",
		"use the type \"unknown\" and lower the confidence accordingly):",
		vocab,
		"",
		"Wire endpoints reference component ids and pin names from the table above. Wire 'path' is optional —",
		"omit it for straight or simple Manhattan routes; include a polyline only when the wire has clear bends",
		"the user would want to preserve.",
		"",
		"Return only the JSON object that matches the response schema. No prose, no markdown fences.",
	].join("\n")

	return { systemMessage, userInstructions }
}
