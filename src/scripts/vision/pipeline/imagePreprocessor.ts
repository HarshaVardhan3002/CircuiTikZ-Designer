// src/scripts/vision/pipeline/imagePreprocessor.ts

/** Maximum long edge after resize, in pixels. */
export const DEFAULT_MAX_EDGE = 2048

export interface TargetDimensions {
	width: number
	height: number
}

/**
 * Pure dimension math. No DOM touching. Scales the image so its long edge equals `maxEdge`,
 * preserving aspect ratio. Returns integer dimensions.
 */
export function computeTargetDimensions(
	sourceWidth: number,
	sourceHeight: number,
	maxEdge: number = DEFAULT_MAX_EDGE,
): TargetDimensions {
	const longEdge = Math.max(sourceWidth, sourceHeight)
	if (longEdge <= maxEdge) {
		return { width: Math.round(sourceWidth), height: Math.round(sourceHeight) }
	}
	const scale = maxEdge / longEdge
	return {
		width:  Math.round(sourceWidth * scale),
		height: Math.round(sourceHeight * scale),
	}
}

export type SupportedMime = "image/jpeg" | "image/png" | "image/webp"

const ALLOWED: SupportedMime[] = ["image/jpeg", "image/png", "image/webp"]

export interface PreprocessResult {
	blob: Blob
	mimeType: SupportedMime
	width: number
	height: number
}

/**
 * Browser-only entry point. Decodes via createImageBitmap, resizes via OffscreenCanvas if
 * available (regular canvas otherwise), re-encodes to the same MIME (PNGs preserved for
 * transparency, others normalised to JPEG @ 0.85). EXIF is stripped automatically by the
 * fresh-canvas re-encode.
 *
 * Throws an Error (not a VisionError - this runs before any provider is involved) on
 * unsupported MIME or decode failure.
 */
export async function preprocessImage(
	file: File | Blob,
	maxEdge: number = DEFAULT_MAX_EDGE,
): Promise<PreprocessResult> {
	const mime = (file as File).type as SupportedMime
	if (!ALLOWED.includes(mime)) {
		throw new Error(`Unsupported image MIME type: ${mime}. Use PNG, JPEG, or WebP.`)
	}

	const bitmap = await createImageBitmap(file)
	try {
		const target = computeTargetDimensions(bitmap.width, bitmap.height, maxEdge)
		const canvas = makeCanvas(target.width, target.height)
		const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
		ctx.drawImage(bitmap, 0, 0, target.width, target.height)

		const outMime: SupportedMime = mime === "image/png" ? "image/png" : "image/jpeg"
		const quality = outMime === "image/jpeg" ? 0.85 : undefined
		const blob = await canvasToBlob(canvas, outMime, quality)
		return { blob, mimeType: outMime, width: target.width, height: target.height }
	} finally {
		bitmap.close?.()
	}
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
	if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h)
	const c = document.createElement("canvas")
	c.width = w
	c.height = h
	return c
}

async function canvasToBlob(
	canvas: HTMLCanvasElement | OffscreenCanvas,
	mime: SupportedMime,
	quality?: number,
): Promise<Blob> {
	if ("convertToBlob" in canvas) {
		return await canvas.convertToBlob({ type: mime, quality })
	}
	return await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(b) => (b ? resolve(b) : reject(new Error("canvas.toBlob returned null"))),
			mime,
			quality,
		)
	})
}
