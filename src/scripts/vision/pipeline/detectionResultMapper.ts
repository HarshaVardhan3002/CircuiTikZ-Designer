// src/scripts/vision/pipeline/detectionResultMapper.ts
import type { ComponentSaveObject } from "../../components/circuitComponent"
import type { ImportResult } from "../../import/diagnostics"
import { DiagnosticsCollector } from "../../import/diagnostics"
import type { DetectionResult } from "../detectionTypes"
import type { ComponentVocabulary, VocabularyEntry } from "../prompts/componentVocabulary"
import { classifyConfidence, DEFAULT_THRESHOLDS, type ConfidenceThresholds } from "./confidenceClassifier"

/**
 * Resolves a CircuiTikZ symbol's tikzName to its save-object kind ("node" or "path"),
 * or null if the tikzName is not registered.
 *
 * Production callers pass a closure over `MainController.instance.symbols`; tests pass
 * a synchronous map-lookup. Keeps the mapper itself DOM-free.
 */
export type SymbolTypeResolver = (tikzName: string) => "node" | "path" | null

/** Save-object types that aren't symbol-backed - these go into `type` directly. */
const PRIMITIVE_SAVE_TYPES = new Set([
	"wire", "cubic-spline", "rect", "polygon", "ellipse", "short", "open", "group",
])

/**
 * Convert a DetectionResult into an ImportResult that the existing applyImportResult pipeline
 * can place. This function is provider-agnostic.
 *
 * Save-shape policy: vocabulary entries' `internalType` is interpreted in two ways -
 *   (a) if it's a primitive jsonID (wire / cubic-spline / rect / polygon / ellipse / short /
 *       open / group), it's used as `type` directly;
 *   (b) otherwise it's a CircuiTikZ tikzName, and we wrap it as
 *       `{ type: "node" | "path", id: <tikzName>, position, rotation }` so the existing
 *       NodeSymbolComponent / PathSymbolComponent factories can hydrate it.
 *
 * Diagnostics policy:
 *   - Each low-confidence component emits an `info` diagnostic with code = vision-low-confidence
 *   - Each unknown-type component emits a `warning` with code = vision-unknown-type
 *   - Each unresolvable wire endpoint emits a `warning` with code = vision-wire-dangling
 *   - Each model-emitted warning becomes an `info` with code = vision-model-warning
 */
export function mapDetectionResult(
	detection: DetectionResult,
	vocab: ComponentVocabulary,
	collector: DiagnosticsCollector,
	resolveSymbol: SymbolTypeResolver = () => null,
	thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS,
): ImportResult {
	const vocabIndex = new Map<string, VocabularyEntry>(
		vocab.entries.map((e) => [e.key, e]),
	)

	const components: ComponentSaveObject[] = []
	/** Map model id → resolved index in `components` for wire endpoint lookup. */
	const idIndex = new Map<string, number>()
	/** Map model id → vocabulary entry, so wire endpoints can resolve pin names. */
	const compEntry = new Map<string, VocabularyEntry | null>()

	for (const c of detection.components) {
		const entry = vocabIndex.get(c.type) ?? null
		const internalType = entry?.internalType ?? "unknown"

		if (!entry) {
			collector.warning(
				`Detected component "${c.id}" had unknown type "${c.type}" - placed as a placeholder.`,
				{ code: "vision-unknown-type", componentRef: c.id, confidence: c.confidence },
			)
		}

		const bucket = classifyConfidence(c.confidence, thresholds)
		if (bucket === "low") {
			collector.info(
				`Component "${c.id}" placed with low confidence (${(c.confidence * 100).toFixed(0)}%) - please review.`,
				{ code: "vision-low-confidence", componentRef: c.id, confidence: c.confidence },
			)
		}

		// We deliberately preserve raw image-pixel coords here; the canvas controller scales them
		// when applyImportResult runs. The detection-pipeline coordinate frame is documented in
		// §6.5 of the spec.
		// detection metadata is hoisted onto the runtime CircuitComponent in applyImportResult.
		const baseMeta = {
			position: { x: c.x, y: c.y },
			rotation: c.rotation,
			detectionConfidence: c.confidence,
			detectionAlternates: c.alternates ?? [],
			detectionId: c.id,
		}

		let save: ComponentSaveObject
		if (PRIMITIVE_SAVE_TYPES.has(internalType)) {
			// Primitive: use the jsonID directly. The save-object will be sparse for shapes that
			// expect fields (e.g. wire wants points/directions) but applyImportResult's per-component
			// catch will route any hydration failure to a diagnostic - graceful degradation.
			save = { type: internalType, ...baseMeta } as unknown as ComponentSaveObject
		} else {
			// Symbol-backed (or `internalType === "unknown"` placeholder).
			// Wrap as a node-symbol or path-symbol save object whose `id` is the tikzName.
			const wrap = resolveSymbol(internalType) ?? "node"
			save = {
				type: wrap,
				id: internalType,
				...baseMeta,
			} as unknown as ComponentSaveObject
		}

		idIndex.set(c.id, components.length)
		compEntry.set(c.id, entry)
		components.push(save)
	}

	for (const w of detection.wires) {
		const fromEntry = compEntry.get(w.from.componentId)
		const toEntry = compEntry.get(w.to.componentId)
		const fromExists = idIndex.has(w.from.componentId)
		const toExists = idIndex.has(w.to.componentId)

		if (!fromExists || !toExists) {
			collector.warning(
				`Wire dropped: endpoint references unknown component (` +
				`${!fromExists ? w.from.componentId : w.to.componentId}).`,
				{ code: "vision-wire-dangling" },
			)
			continue
		}
		// Pin sanity. If the model emits an unknown pin we still place the wire - the renderer
		// will fall back to the component's first pin.
		const fromPinKnown = fromEntry?.pins.includes(w.from.pin) ?? false
		const toPinKnown   = toEntry?.pins.includes(w.to.pin) ?? false
		if (!fromPinKnown || !toPinKnown) {
			collector.info(
				`Wire from ${w.from.componentId}:${w.from.pin} → ${w.to.componentId}:${w.to.pin} ` +
				`references a pin not in the vocabulary; routed to the default pin.`,
				{ code: "vision-wire-pin-fallback" },
			)
		}

		// Build a real WireSaveObject the existing pipeline can hydrate.
		// - If the LLM provided a polyline `path`, use it verbatim.
		// - Otherwise route a straight line between the two source components' centers
		//   (image-pixel coords; canvas controller will scale just like other vision-import points).
		// Pin-position-aware routing is V1.1 work - the spec §6.5 explicitly accepts a Manhattan
		// fallback for V1.
		const fromIdx = idIndex.get(w.from.componentId)!
		const toIdx = idIndex.get(w.to.componentId)!
		// baseMeta puts `position` on every component save object regardless of branch above.
		const fromSave = components[fromIdx] as unknown as { position: { x: number; y: number } }
		const toSave   = components[toIdx]   as unknown as { position: { x: number; y: number } }
		const points = (w.path && w.path.length >= 2)
			? w.path.map((p) => ({ x: p.x, y: p.y }))
			: [
				{ x: fromSave.position.x, y: fromSave.position.y },
				{ x: toSave.position.x,   y: toSave.position.y },
			]
		// One direction segment per gap. WireDirection.Straight === "--".
		const directions = Array<string>(points.length - 1).fill("--")

		components.push({
			type: "wire",
			points,
			directions,
			detectionConfidence: w.confidence,
		} as unknown as ComponentSaveObject)
	}

	for (const m of detection.warnings) {
		collector.info(m, { code: "vision-model-warning" })
	}

	return {
		format: "image",
		success: components.length > 0,
		components,
		diagnostics: collector.all(),
		sourceText: "",
		// imageBoundsHint travels along so the canvas controller can scale.
		visionImageBounds: detection.imageBoundsHint,
	} as unknown as ImportResult
}
