// src/scripts/vision/visionError.ts

export type VisionErrorKind =
	| "auth"        // 401, bad API key
	| "rate-limit"  // 429
	| "bad-request" // 400 - usually means model doesn't accept vision
	| "network"     // fetch threw / DNS / TLS / offline
	| "schema"      // response wasn't valid JSON, or didn't match shape
	| "cancelled"   // user pressed Cancel (AbortController)
	| "unknown"

export class VisionError extends Error {
	readonly kind: VisionErrorKind
	readonly retryable: boolean
	readonly httpStatus?: number
	readonly providerId?: string

	constructor(
		kind: VisionErrorKind,
		message: string,
		opts: { retryable?: boolean; httpStatus?: number; providerId?: string; cause?: unknown } = {},
	) {
		super(message, { cause: opts.cause })
		this.name = "VisionError"
		this.kind = kind
		this.retryable = opts.retryable ?? defaultRetryable(kind)
		this.httpStatus = opts.httpStatus
		this.providerId = opts.providerId
	}
}

function defaultRetryable(k: VisionErrorKind): boolean {
	switch (k) {
		case "rate-limit":
		case "network":
		case "schema":
			return true
		case "auth":
		case "bad-request":
		case "cancelled":
		case "unknown":
			return false
	}
}
