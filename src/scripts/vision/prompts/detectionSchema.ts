// src/scripts/vision/prompts/detectionSchema.ts

/**
 * JSON schema for the LLM's structured output. The shape mirrors DetectedComponent /
 * DetectedWire / DetectionResult in detectionTypes.ts. We intentionally repeat the schema
 * here as a runtime literal - keeping it as a value (not a type) lets us pass it directly
 * to providers that support `response_format: { type: "json_schema" }`.
 */
export const detectionSchema = {
	type: "object",
	additionalProperties: false,
	required: ["components", "wires", "warnings"],
	properties: {
		components: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["id", "type", "x", "y", "rotation", "confidence"],
				properties: {
					id:         { type: "string", minLength: 1, maxLength: 32 },
					type:       { type: "string", minLength: 1, maxLength: 64 },
					x:          { type: "number" },
					y:          { type: "number" },
					rotation:   { type: "number" },
					confidence: { type: "number", minimum: 0, maximum: 1 },
					alternates: {
						type: "array",
						maxItems: 3,
						items: {
							type: "object",
							additionalProperties: false,
							required: ["type", "confidence"],
							properties: {
								type:       { type: "string" },
								confidence: { type: "number", minimum: 0, maximum: 1 },
							},
						},
					},
					rawLabel: { type: "string" },
				},
			},
		},
		wires: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["from", "to", "confidence"],
				properties: {
					from: {
						type: "object",
						additionalProperties: false,
						required: ["componentId", "pin"],
						properties: {
							componentId: { type: "string" },
							pin:         { type: "string" },
						},
					},
					to: {
						type: "object",
						additionalProperties: false,
						required: ["componentId", "pin"],
						properties: {
							componentId: { type: "string" },
							pin:         { type: "string" },
						},
					},
					path: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							required: ["x", "y"],
							properties: { x: { type: "number" }, y: { type: "number" } },
						},
					},
					confidence: { type: "number", minimum: 0, maximum: 1 },
				},
			},
		},
		warnings: { type: "array", items: { type: "string" } },
		imageBoundsHint: {
			type: "object",
			additionalProperties: false,
			properties: {
				width:  { type: "number" },
				height: { type: "number" },
			},
		},
	},
} as const
