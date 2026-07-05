// src/scripts/vision/visionProvider.ts
import type { DetectionResult } from "./detectionTypes"
import type { ComponentVocabulary } from "./prompts/componentVocabulary"

export type ProviderId = "openai-compat" | "anthropic" | "gemini" | (string & {})

export interface ProviderConfig {
	providerId: ProviderId
	/** Optional override; defaults are baked into each adapter. */
	baseUrl?: string
	apiKey: string
	model: string
	/** Defaults to 0 (deterministic). */
	temperature?: number
	/** Defaults to 4096. */
	maxOutputTokens?: number
	/** Optional override of the system prompt. Use only if you know what you're doing. */
	systemPromptOverride?: string
}

export interface ValidationResult {
	ok: boolean
	errors: string[]
}

export interface DetectionInput {
	imageBlob: Blob
	imageMimeType: "image/jpeg" | "image/png" | "image/webp"
	imageWidth: number
	imageHeight: number
	vocabulary: ComponentVocabulary
}

export interface CircuitVisionProvider {
	readonly id: ProviderId
	readonly displayName: string
	/** Local check; never makes a network call. */
	validateConfig(c: ProviderConfig): ValidationResult
	/** Optional: a real network round-trip that proves the endpoint is reachable. */
	testConnection?(c: ProviderConfig, signal?: AbortSignal): Promise<ValidationResult>
	detect(
		input: DetectionInput,
		config: ProviderConfig,
		signal?: AbortSignal,
	): Promise<DetectionResult>
}

const registry = new Map<ProviderId, CircuitVisionProvider>()

export function registerProvider(p: CircuitVisionProvider): void {
	registry.set(p.id, p)
}

export function getProvider(id: ProviderId): CircuitVisionProvider | undefined {
	return registry.get(id)
}

export function listProviders(): CircuitVisionProvider[] {
	return Array.from(registry.values())
}

/** Test-only: clear the registry so tests don't leak adapters into one another. */
export function _clearRegistryForTests(): void {
	registry.clear()
}
