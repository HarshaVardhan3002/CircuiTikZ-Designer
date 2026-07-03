// src/scripts/vision/detectionTypes.ts

/**
 * What the model is asked to emit per component. Field names are the *transport* names - the
 * mapper folds these into our internal CircuitComponent shape.
 */
export interface DetectedComponent {
	/** Stable id within the response, e.g. "C1". */
	id: string
	/** Vocabulary key; unknown values fall back to the placeholder type in the mapper. */
	type: string
	/** Image-pixel coordinates, top-left origin. */
	x: number
	y: number
	/** Degrees, clockwise; 0 / 90 / 180 / 270 are the common cases. */
	rotation: number
	/** 0..1. */
	confidence: number
	/** Top-3 alternative types the model also considered, used by the inline correction popover. */
	alternates?: { type: string; confidence: number }[]
	/** Any text the model "saw" near this symbol. Surfaced in V1.1 for label/value OCR. */
	rawLabel?: string
}

export interface DetectedWireEndpoint {
	componentId: string
	pin: string
}

export interface DetectedWire {
	from: DetectedWireEndpoint
	to: DetectedWireEndpoint
	/** Optional polyline; if absent we route a Manhattan path between the two pins. */
	path?: { x: number; y: number }[]
	confidence: number
}

export interface DetectionResult {
	components: DetectedComponent[]
	wires: DetectedWire[]
	/** Free-text warnings emitted by the model. Surfaced as info diagnostics. */
	warnings: string[]
	/** Image dimensions the model saw. Used by the mapper to convert to canvas units. */
	imageBoundsHint?: { width: number; height: number }
}

/** Bucket assigned by the confidence classifier - drives overlay rendering. */
export type ConfidenceBucket = "high" | "medium" | "low"
