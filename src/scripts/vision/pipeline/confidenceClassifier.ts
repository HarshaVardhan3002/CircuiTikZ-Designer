// src/scripts/vision/pipeline/confidenceClassifier.ts
import type { ConfidenceBucket } from "../detectionTypes"

export interface ConfidenceThresholds {
	/** Below this → "low". 0.7 is the default — items below this are flagged on the canvas. */
	medium: number
	/** At or above this → "high". 0.85 is the default — items above this carry no overlay. */
	high: number
}

export const DEFAULT_THRESHOLDS: ConfidenceThresholds = { medium: 0.7, high: 0.85 }

export function classifyConfidence(
	c: number,
	thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS,
): ConfidenceBucket {
	if (c >= thresholds.high)   return "high"
	if (c >= thresholds.medium) return "medium"
	return "low"
}
