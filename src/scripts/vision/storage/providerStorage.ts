// src/scripts/vision/storage/providerStorage.ts
import type { ProviderConfig, ProviderId } from "../visionProvider"

const KEY_ACTIVE = "circuitvision.activeProvider"
const KEY_CONFIG_PREFIX = "circuitvision.providers."
const ENCRYPTED_SUFFIX = ".encrypted"

/**
 * Encrypt data using Web Crypto API (AES-GCM).
 * Falls back to plain storage if crypto.subtle is unavailable.
 */
async function encryptData(data: string): Promise<string> {
	try {
		if (!window.crypto?.subtle) {
			// Web Crypto not available - use plain storage with warning
			console.warn("Web Crypto API not available, storing data unencrypted")
			return btoa(data)
		}

		const encoder = new TextEncoder()
		const dataBytes = encoder.encode(data)

		// Generate a key for this origin (storage-scoped)
		const keyMaterial = await window.crypto.subtle.importKey(
			"raw",
			encoder.encode(window.location.origin),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"]
		)

		// Create an IV
		const iv = window.crypto.getRandomValues(new Uint8Array(12))

		// Encrypt
		const encryptedBytes = await window.crypto.subtle.encrypt(
			{
				name: "AES-GCM",
				iv: iv,
			},
			keyMaterial,
			dataBytes
		)

		// Combine IV + ciphertext and base64 encode
		const combined = new Uint8Array(iv.length + encryptedBytes.byteLength)
		combined.set(iv)
		combined.set(new Uint8Array(encryptedBytes), iv.length)

		return btoa(String.fromCharCode(...combined))
	} catch (err) {
		console.warn("Encryption failed, storing data unencrypted:", err)
		return btoa(data)
	}
}

/**
 * Decrypt data using Web Crypto API.
 */
async function decryptData(encrypted: string): Promise<string> {
	try {
		if (!window.crypto?.subtle) {
			// Web Crypto not available
			const decoded = atob(encrypted)
			return new TextDecoder().decode(Uint8Array.from(decoded, c => c.charCodeAt(0)))
		}

		// Decode from base64
		const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0))

		// Extract IV and ciphertext
		if (combined.length < 12) {
			throw new Error("Invalid encrypted data")
		}

		const iv = combined.slice(0, 12)
		const ciphertext = combined.slice(12)

		// Get key material (same as encryption)
		const encoder = new TextEncoder()
		const keyMaterial = await window.crypto.subtle.importKey(
			"raw",
			encoder.encode(window.location.origin),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"]
		)

		// Decrypt
		const decryptedBytes = await window.crypto.subtle.decrypt(
			{
				name: "AES-GCM",
				iv: iv,
			},
			keyMaterial,
			ciphertext
		)

		return new TextDecoder().decode(decryptedBytes)
	} catch (err) {
		console.warn("Decryption failed, trying plain decode:", err)
		const decoded = atob(encrypted)
		return new TextDecoder().decode(Uint8Array.from(decoded, c => c.charCodeAt(0)))
	}
}

export function getActiveProviderId(): ProviderId | null {
	const v = localStorage.getItem(KEY_ACTIVE)
	return v && v.length > 0 ? (v as ProviderId) : null
}

export async function setActiveProviderId(id: ProviderId): Promise<void> {
	localStorage.setItem(KEY_ACTIVE, id)
}

export async function clearActiveProviderId(): Promise<void> {
	localStorage.removeItem(KEY_ACTIVE)
}

/**
 * Load a provider config, attempting decryption first.
 */
export async function loadProviderConfig(id: ProviderId): Promise<ProviderConfig | null> {
	const key = KEY_CONFIG_PREFIX + id
	const encryptedKey = key + ENCRYPTED_SUFFIX

	// Try encrypted version first
	let raw = localStorage.getItem(encryptedKey)
	if (raw) {
		try {
			const decrypted = await decryptData(raw)
			const parsed = JSON.parse(decrypted) as ProviderConfig
			if (typeof parsed?.apiKey === "string" && typeof parsed?.model === "string") {
				return parsed
			}
			// Invalid data - remove it
			localStorage.removeItem(encryptedKey)
		} catch (err) {
			console.warn("Failed to decrypt provider config:", err)
			localStorage.removeItem(encryptedKey)
		}
	}

	// Fall back to plain storage for backwards compatibility
	raw = localStorage.getItem(key)
	if (!raw) return null

	try {
		const parsed = JSON.parse(raw) as ProviderConfig
		if (typeof parsed?.apiKey !== "string" || typeof parsed?.model !== "string") {
			localStorage.removeItem(key)
			return null
		}

		// Auto-migrate to encrypted storage
		void saveProviderConfig(parsed)

		return parsed
	} catch {
		// Corrupted JSON - wipe so the user sees a clean re-config UX.
		localStorage.removeItem(key)
		return null
	}
}

/**
 * Save a provider config with encryption.
 */
export async function saveProviderConfig(c: ProviderConfig): Promise<void> {
	const key = KEY_CONFIG_PREFIX + c.providerId
	const encryptedKey = key + ENCRYPTED_SUFFIX

	try {
		const json = JSON.stringify(c)
		const encrypted = await encryptData(json)
		localStorage.setItem(encryptedKey, encrypted)

		// Remove plain version if it exists (migration)
		if (localStorage.getItem(key)) {
			localStorage.removeItem(key)
		}
	} catch (err) {
		console.error("Failed to save provider config:", err)
		throw err
	}
}

export async function deleteProviderConfig(id: ProviderId): Promise<void> {
	const key = KEY_CONFIG_PREFIX + id
	const encryptedKey = key + ENCRYPTED_SUFFIX
	localStorage.removeItem(encryptedKey)
	localStorage.removeItem(key)
}
