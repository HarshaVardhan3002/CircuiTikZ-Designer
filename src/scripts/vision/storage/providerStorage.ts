// src/scripts/vision/storage/providerStorage.ts
import type { ProviderConfig, ProviderId } from "../visionProvider"

const KEY_ACTIVE = "circuitvision.activeProvider"
const KEY_CONFIG_PREFIX = "circuitvision.providers."

export function getActiveProviderId(): ProviderId | null {
	const v = localStorage.getItem(KEY_ACTIVE)
	return v && v.length > 0 ? (v as ProviderId) : null
}

export function setActiveProviderId(id: ProviderId): void {
	localStorage.setItem(KEY_ACTIVE, id)
}

export function clearActiveProviderId(): void {
	localStorage.removeItem(KEY_ACTIVE)
}

export function loadProviderConfig(id: ProviderId): ProviderConfig | null {
	const key = KEY_CONFIG_PREFIX + id
	const raw = localStorage.getItem(key)
	if (!raw) return null
	try {
		const parsed = JSON.parse(raw) as ProviderConfig
		// Minimum-viable shape check; we don't lock down unknown keys.
		if (typeof parsed?.apiKey !== "string" || typeof parsed?.model !== "string") {
			localStorage.removeItem(key)
			return null
		}
		return parsed
	} catch {
		// Corrupted JSON — wipe so the user sees a clean re-config UX.
		localStorage.removeItem(key)
		return null
	}
}

export function saveProviderConfig(c: ProviderConfig): void {
	const key = KEY_CONFIG_PREFIX + c.providerId
	localStorage.setItem(key, JSON.stringify(c))
}

export function deleteProviderConfig(id: ProviderId): void {
	localStorage.removeItem(KEY_CONFIG_PREFIX + id)
}
