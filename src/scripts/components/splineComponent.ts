import * as SVG from "@svgdotjs/svg.js"
import {
	bboxFromPoints,
	ButtonGridProperty,
	CanvasController,
	CircuitComponent,
	defaultStroke,
	MainController,
	PathComponent,
	PathSaveObject,
	PropertyCategories,
	SaveController,
	SectionHeaderProperty,
	SelectionController,
	SnappingInfo,
	SnapPoint,
	Strokable,
	StrokeInfo,
	TikzPathCommand,
} from "../internal"
import { AdjustDragHandler } from "../snapDrag/dragHandlers"
import { handleControlSVG, resizeSVG, selectedBoxWidth, selectionSize } from "../utils/selectionHelper"

/** Built-in curve shapes offered in the component drawer (drop ready-made instead of hand-drawing). */
export type SplinePresetKind = "arc" | "scurve" | "wave"
/** A preset is a list of anchors with handle offsets, relative to the drop point (in px). */
export type SplinePresetTemplate = {
	rel: SVG.Point
	inHandle: SVG.Point | null
	outHandle: SVG.Point | null
}[]

// px per "unit" (~1cm) used to size the built-in curve presets.
const PRESET_U = 40
const SPLINE_PRESETS: Record<SplinePresetKind, SplinePresetTemplate> = {
	arc: [
		{ rel: new SVG.Point(-2 * PRESET_U, 0), inHandle: null, outHandle: new SVG.Point(0, -2.4 * PRESET_U) },
		{ rel: new SVG.Point(2 * PRESET_U, 0), inHandle: new SVG.Point(0, -2.4 * PRESET_U), outHandle: null },
	],
	scurve: [
		{ rel: new SVG.Point(-2 * PRESET_U, 1.5 * PRESET_U), inHandle: null, outHandle: new SVG.Point(2 * PRESET_U, 0) },
		{ rel: new SVG.Point(2 * PRESET_U, -1.5 * PRESET_U), inHandle: new SVG.Point(-2 * PRESET_U, 0), outHandle: null },
	],
	wave: [
		{ rel: new SVG.Point(-3 * PRESET_U, 0), inHandle: null, outHandle: new SVG.Point(PRESET_U, -1.8 * PRESET_U) },
		{ rel: new SVG.Point(0, 0), inHandle: new SVG.Point(-PRESET_U, -1.8 * PRESET_U), outHandle: new SVG.Point(PRESET_U, 1.8 * PRESET_U) },
		{ rel: new SVG.Point(3 * PRESET_U, 0), inHandle: new SVG.Point(-PRESET_U, 1.8 * PRESET_U), outHandle: null },
	],
}

/**
 * Continuity rule between an interior anchor's two handles.
 *
 *  - `corner`: the handles are independent. The anchor is a kink.
 *  - `g1`: the handles point along the same line; their lengths may differ.
 *  - `c1`: the handles are point-mirrored. Same direction, same length.
 *
 * Endpoints (first / last anchor) only have one handle, so the flag is ignored.
 */
export type SplineContinuity = "corner" | "g1" | "c1"

export type SplineAnchor = {
	position: SVG.Point
	/** Offset from `position` to the incoming control point. `null` on the first anchor. */
	inHandle: SVG.Point | null
	/** Offset from `position` to the outgoing control point. `null` on the last anchor. */
	outHandle: SVG.Point | null
	continuity: SplineContinuity
}

type SerializedHandle = { x: number; y: number } | null

type SerializedAnchor = {
	position: { x: number; y: number }
	inHandle: SerializedHandle
	outHandle: SerializedHandle
	continuity: SplineContinuity
}

export type SplineSaveObject = PathSaveObject & {
	anchors: SerializedAnchor[]
	stroke?: StrokeInfo
}

const HANDLE_KEY_INSET = 1e-6

/**
 * Single source of truth for the three anchor-continuity choices. Used both by the
 * properties pane (`ButtonGridProperty`) and the per-anchor right-click context menu.
 * Adding a fourth continuity mode (e.g. C² acceleration-smooth) is a one-line edit here.
 */
type ContinuityOption = {
	key: SplineContinuity
	label: string
	tooltip: string
}
const CONTINUITY_OPTIONS: ContinuityOption[] = [
	{
		key: "corner",
		label: "Corner",
		tooltip: "Independent handles. Drag either side without affecting the other.",
	},
	{
		key: "g1",
		label: "G¹ smooth",
		tooltip: "Handles share a tangent line; their lengths can differ.",
	},
	{
		key: "c1",
		label: "C¹ mirror",
		tooltip: "Handles are mirrored: same direction, same length.",
	},
]

/**
 * Cubic Bézier spline. A chain of anchors connected by cubic segments — each anchor
 * carries up to two handles, and TikZ export emits `(.) .. controls (.) and (.) .. (.)`
 * groups. Smooth/mirror constraints are enforced live while the user drags handles, so
 * the geometry never drifts away from the C¹ or G¹ relationship the user asked for.
 *
 * Defaults match what {@link WireComponent} and {@link PolygonComponent} use, so a spline
 * dropped on the canvas looks at home next to the rest of the path components.
 */
export class SplineComponent extends Strokable(PathComponent) {
	private static jsonID = "cubic-spline"
	static {
		CircuitComponent.jsonSaveMap.set(SplineComponent.jsonID, SplineComponent)
	}

	private anchors: SplineAnchor[] = []

	private curve: SVG.Path
	private dragCurve: SVG.Path
	private handleOverlay: SVG.G | null = null
	private handleHandles: SVG.Element[] = []
	private handleLines: SVG.Line[] = []
	private continuityProperty: ButtonGridProperty | null = null
	private activeAnchor = -1

	/** When set, this spline drops as a ready-made preset shape (single click) instead of being
	 *  drawn anchor-by-anchor. See {@link fromPreset}. */
	private presetTemplate: SplinePresetTemplate | null = null

	/** Create a spline pre-loaded with a built-in curve shape, placed in a single click. */
	public static fromPreset(kind: SplinePresetKind): SplineComponent {
		const s = new SplineComponent()
		s.presetTemplate = SPLINE_PRESETS[kind]
		return s
	}

	// --- geometry caches ---
	// Rebuilding the SVG path-string and the polyline approximation every drag-move
	// is the dominant cost on long splines. We invalidate via `invalidateGeometry`
	// whenever a position or handle moves; reads are O(1) when the cache is warm.
	private pathStringCache: string | null = null
	private bboxCache: SVG.Box | null = null
	private polylineCache: SVG.Point[] | null = null

	// rAF coalescing — multiple synchronous mutations during a drag (e.g. C¹ enforce
	// touches both handles back-to-back) collapse to a single frame's render.
	private updateScheduled = false

	public constructor() {
		super()
		this.referencePoints = []
		this.pointLimit = -1
		this.displayName = "Spline"

		this.curve = CanvasController.instance.canvas.path("")
		this.curve.fill("none")

		this.dragCurve = CanvasController.instance.canvas.path("")
		this.dragCurve.attr({
			fill: "none",
			stroke: "transparent",
			"stroke-width": selectionSize,
		})

		this.strokeWidthProperty.value = new SVG.Number("0.4pt")
		this.strokeInfo.width = this.strokeWidthProperty.value

		this.visualization.add(this.curve)
		this.visualization.add(this.dragCurve)
		this.snappingPoints = []

		this.properties.add(
			PropertyCategories.options,
			new SectionHeaderProperty("Anchor continuity", undefined, "spline:header")
		)
		this.continuityProperty = new ButtonGridProperty(
			3,
			CONTINUITY_OPTIONS.map((opt): [string, string] => [opt.label, ""]),
			CONTINUITY_OPTIONS.map((opt) => () => this.applyContinuityToActive(opt.key)),
			false,
			CONTINUITY_OPTIONS.map((opt) => opt.tooltip),
			"spline:continuity"
		)
		this.properties.add(PropertyCategories.options, this.continuityProperty)
	}

	public updateTheme(): void {
		let strokeColor = this.strokeInfo.color
		if (strokeColor == "default") {
			strokeColor = defaultStroke
		}

		this.curve.stroke({
			color: strokeColor,
			opacity: this.strokeInfo.opacity,
			width: this.strokeInfo.opacity == 0 ? 0 : this.strokeInfo.width.convertToUnit("px").value,
			dasharray: this.strokeStyleProperty.value.dasharray
				.map((factor) => this.strokeInfo.width.times(factor).toString())
				.join(" "),
		})

		if (this.finishedPlacing) {
			this.update()
		}
	}

	public getSnappingInfo(): SnappingInfo {
		if (this.finishedPlacing) {
			return {
				trackedSnappingPoints: this.snappingPoints,
				additionalSnappingPoints: [],
			}
		}
		return {
			trackedSnappingPoints: [],
			additionalSnappingPoints:
				this.referencePoints.length > 0 ? [new SnapPoint(this, "center", new SVG.Point())] : [],
		}
	}

	public recalculateSnappingPoints(): void {
		super.recalculateSnappingPoints(this.getTransformMatrix())
	}

	public viewSelected(show: boolean): void {
		super.viewSelected(show)
		this.resizable(this.isSelected && show && SelectionController.instance.currentlySelectedComponents.length == 1)
	}

	public resizable(enable: boolean): void {
		if (this.isResizing == enable) {
			return
		}
		this.isResizing = enable
		if (enable) {
			this.attachAnchorDragHandlers()
			this.attachHandleDragHandlers()
		} else {
			this.detachDragHandlers()
		}
		this.update()
	}

	private attachAnchorDragHandlers() {
		for (let index = 0; index < this.referencePoints.length; index++) {
			const element = resizeSVG()
			element.node.style.cursor = "move"
			this.resizableSVGs.push(element)

			let startPos: SVG.Point
			AdjustDragHandler.snapDrag(this, element, true, {
				dragStart: (pos) => {
					startPos = this.referencePoints[index].clone()
					this.activeAnchor = index
				},
				dragMove: (pos) => {
					this.referencePoints[index] = pos
					this.anchors[index].position = pos
					this.invalidateGeometry()
					this.scheduleUpdate()
				},
				dragEnd: () => {
					this.update()
					return !this.referencePoints[index].eq(startPos)
				},
			})

			// Hover an anchor to focus it: its handles pop and the others dim (declutter).
			element.node.addEventListener("mouseenter", () => {
				this.activeAnchor = index
				this.recalculateHandleOverlay()
			})

			// Right-click an anchor for the per-anchor menu (continuity + insert/delete).
			element.node.addEventListener("contextmenu", (ev: MouseEvent) => {
				ev.preventDefault()
				ev.stopPropagation()
				this.activeAnchor = index
				this.openAnchorContextMenu(ev, index)
			})
		}
	}

	private attachHandleDragHandlers() {
		this.handleOverlay = CanvasController.instance.canvas.group()
		this.handleOverlay.addClass("spline-handle-overlay")
		this.visualization.add(this.handleOverlay)

		for (let index = 0; index < this.anchors.length; index++) {
			const anchor = this.anchors[index]
			if (anchor.inHandle) this.spawnHandleControl(index, "in")
			if (anchor.outHandle) this.spawnHandleControl(index, "out")
		}
	}

	private spawnHandleControl(index: number, side: "in" | "out") {
		const anchor = this.anchors[index]
		const handle = side === "in" ? anchor.inHandle : anchor.outHandle
		if (!handle) return

		const line = this.handleOverlay!.line(0, 0, 0, 0)
		// Tangent line: visible enough to read which anchor a handle belongs to, but still secondary.
		line.stroke({ color: "var(--bs-orange)", width: 0.75, opacity: 0.6, dasharray: "3 2" })
		line.fill("none")
		this.handleLines.push(line)

		// Hollow-orange ring (distinct from the filled cyan square anchors) with a large hit target
		// so overlapping control points are easy to tell apart and grab even when stacked.
		const dot = handleControlSVG()
		dot.node.style.cursor = "grab"
		dot.addTo(this.handleOverlay!)
		// Hover affordance: fill the ring so the user can see exactly which handle they'll grab.
		const ring = dot.children()[1] as SVG.Circle
		dot.node.addEventListener("mouseenter", () => {
			ring.fill("var(--bs-orange)")
			this.activeAnchor = index
			this.recalculateHandleOverlay()
		})
		dot.node.addEventListener("mouseleave", () => ring.fill("white"))
		this.handleHandles.push(dot)

		AdjustDragHandler.snapDrag(this, dot, true, {
			dragStart: () => {
				this.activeAnchor = index
			},
			dragMove: (pos) => {
				const offset = pos.sub(this.anchors[index].position)
				if (side === "in") {
					this.anchors[index].inHandle = offset
				} else {
					this.anchors[index].outHandle = offset
				}
				this.enforceContinuity(index, side)
				this.invalidateGeometry()
				this.scheduleUpdate()
			},
			dragEnd: () => {
				this.update()
				return true
			},
		})
	}

	/**
	 * Right-click context menu for an anchor. Lets the user toggle continuity per-anchor
	 * without going through the global properties panel, plus insert / delete operations
	 * that are otherwise hard to discover.
	 */
	private openAnchorContextMenu(ev: MouseEvent, index: number) {
		const a = this.anchors[index]
		const isInterior = a.inHandle !== null && a.outHandle !== null
		const menu = document.createElement("ul")
		menu.className = "dropdown-menu show"
		menu.style.position = "fixed"
		menu.style.left = ev.clientX + "px"
		menu.style.top = ev.clientY + "px"
		menu.style.zIndex = "10000"

		const addItem = (label: string, onClick: () => void, disabled = false) => {
			const li = document.createElement("li")
			const a = document.createElement("a")
			a.className = "dropdown-item" + (disabled ? " disabled" : "")
			a.textContent = label
			a.style.cursor = disabled ? "default" : "pointer"
			if (!disabled) {
				a.addEventListener("mousedown", (e) => {
					e.preventDefault()
					e.stopPropagation()
					onClick()
					closeMenu()
				})
			}
			li.appendChild(a)
			menu.appendChild(li)
		}

		const closeMenu = () => {
			menu.remove()
			document.removeEventListener("mousedown", outsideClick, true)
		}
		const outsideClick = (e: MouseEvent) => {
			if (!menu.contains(e.target as Node)) closeMenu()
		}

		if (isInterior) {
			for (const opt of CONTINUITY_OPTIONS) {
				addItem(`${opt.label}${a.continuity === opt.key ? " ✓" : ""}`, () => this.applyContinuityToActive(opt.key))
			}
			menu.appendChild(Object.assign(document.createElement("li"), { innerHTML: '<hr class="dropdown-divider">' }))
		}
		addItem(
			"Insert anchor before",
			() => this.insertAnchorAt(index),
			index === 0
		)
		addItem(
			"Insert anchor after",
			() => this.insertAnchorAt(index + 1),
			index === this.anchors.length - 1
		)
		addItem(
			"Delete anchor",
			() => this.deleteAnchor(index),
			this.anchors.length <= 2
		)

		document.body.appendChild(menu)
		// Defer so the contextmenu's own mouseup doesn't immediately close the menu.
		setTimeout(() => document.addEventListener("mousedown", outsideClick, true), 0)
	}

	/**
	 * Insert a fresh anchor at `index` (the new anchor takes that slot, existing ones shift).
	 * Position is the average of its neighbours' positions, handles regenerate.
	 */
	private insertAnchorAt(index: number) {
		const before = this.anchors[index - 1]
		const after = this.anchors[index]
		if (!before || !after) return
		const pos = before.position.add(after.position).div(2)
		this.anchors.splice(index, 0, {
			position: pos,
			inHandle: new SVG.Point(),
			outHandle: new SVG.Point(),
			continuity: "corner",
		})
		this.referencePoints.splice(index, 0, pos)
		this.regenerateDefaultHandles()
		// Re-attach drag handlers — the resizable arrays are stale after the splice.
		this.resizable(false)
		this.resizable(true)
		this.update()
	}

	/** Remove the anchor at `index`. No-op if it would leave fewer than two anchors. */
	private deleteAnchor(index: number) {
		if (this.anchors.length <= 2) return
		this.anchors.splice(index, 1)
		this.referencePoints.splice(index, 1)
		// Endpoints lose their unused handles — let regenerateDefaultHandles fix the survivors.
		if (index === 0 || index === this.anchors.length) {
			this.regenerateDefaultHandles()
		} else {
			this.invalidateGeometry()
		}
		this.resizable(false)
		this.resizable(true)
		this.update()
	}

	private detachDragHandlers() {
		for (const pointSVG of this.resizableSVGs) {
			AdjustDragHandler.snapDrag(this, pointSVG, false)
			pointSVG?.remove()
		}
		this.resizableSVGs = []

		for (const dot of this.handleHandles) {
			AdjustDragHandler.snapDrag(this, dot, false)
			dot.remove()
		}
		this.handleHandles = []

		for (const line of this.handleLines) {
			line.remove()
		}
		this.handleLines = []

		this.handleOverlay?.remove()
		this.handleOverlay = null
		this.activeAnchor = -1
	}

	/** Pull the dependent handle in line with the source after a drag, if continuity demands it. */
	private enforceContinuity(index: number, dragged: "in" | "out") {
		const a = this.anchors[index]
		if (a.continuity === "corner") return
		if (!a.inHandle || !a.outHandle) return

		if (dragged === "in") {
			if (a.continuity === "c1") {
				a.outHandle = a.inHandle.mul(-1)
			} else {
				const len = a.inHandle.abs()
				if (len < HANDLE_KEY_INSET) return
				const dir = a.inHandle.div(len).mul(-1)
				const outLen = a.outHandle.abs()
				a.outHandle = dir.mul(outLen)
			}
		} else {
			if (a.continuity === "c1") {
				a.inHandle = a.outHandle.mul(-1)
			} else {
				const len = a.outHandle.abs()
				if (len < HANDLE_KEY_INSET) return
				const dir = a.outHandle.div(len).mul(-1)
				const inLen = a.inHandle.abs()
				a.inHandle = dir.mul(inLen)
			}
		}
	}

	private applyContinuityToActive(mode: SplineContinuity) {
		if (this.activeAnchor < 0) {
			// fall back to the first interior anchor — gives the toolbar buttons a sensible default
			// if the user hasn't actually clicked on a handle yet.
			for (let i = 1; i < this.anchors.length - 1; i++) {
				this.setAnchorContinuity(i, mode)
			}
		} else {
			this.setAnchorContinuity(this.activeAnchor, mode)
		}
		this.update()
	}

	private setAnchorContinuity(index: number, mode: SplineContinuity) {
		const a = this.anchors[index]
		if (!a) return
		if (!a.inHandle || !a.outHandle) {
			// Endpoints — store the flag so save/load is consistent but don't touch the (null) handle.
			a.continuity = mode
			return
		}
		a.continuity = mode
		if (mode === "c1") {
			a.outHandle = a.inHandle.mul(-1)
		} else if (mode === "g1") {
			const len = a.inHandle.abs()
			if (len > HANDLE_KEY_INSET) {
				const dir = a.inHandle.div(len).mul(-1)
				a.outHandle = dir.mul(a.outHandle.abs())
			}
		}
		this.invalidateGeometry()
	}

	public placeMove(pos: SVG.Point, ev?: Event): void {
		if (this.presetTemplate) {
			// Preset shapes follow the cursor as a rigid unit until the click drops them.
			this.referencePoints = this.presetTemplate.map((t) => t.rel.add(pos))
			this.anchors = this.presetTemplate.map((t): SplineAnchor => ({
				position: t.rel.add(pos),
				inHandle: t.inHandle ? t.inHandle.clone() : null,
				outHandle: t.outHandle ? t.outHandle.clone() : null,
				continuity: "corner",
			}))
			this.curve.show()
			this.invalidateGeometry()
			this.update()
			return
		}
		if (this.referencePoints.length > 0) {
			const lastIndex = this.referencePoints.length - 1
			this.referencePoints[lastIndex] = pos.clone()
			this.anchors[lastIndex].position = pos.clone()
			this.invalidateGeometry()
			this.regenerateDefaultHandles()
			this.update()
		}
	}

	public placeStep(pos: SVG.Point, ev?: Event): boolean {
		if (this.presetTemplate) {
			// Single click finalises a preset shape.
			this.placeMove(pos, ev)
			return true
		}
		if (this.finishedPlacing) {
			return true
		}

		if (this.referencePoints.length == 0) {
			this.referencePoints.push(pos.clone())
			this.anchors.push({
				position: pos.clone(),
				inHandle: null,
				outHandle: null,
				continuity: "corner",
			})
			this.curve.show()
			this.updateTheme()
		} else if (this.referencePoints.at(-2)?.eq(pos)) {
			// double click on the same spot — finish.
			return true
		}

		this.referencePoints.push(pos.clone())
		this.anchors.push({
			position: pos.clone(),
			inHandle: null,
			outHandle: null,
			continuity: "corner",
		})
		this.regenerateDefaultHandles()
		this.placeMove(pos, ev)
		return false
	}

	public placeFinish(): void {
		if (this.finishedPlacing) {
			return
		}
		if (this.presetTemplate) {
			// Anchors are already set by placeMove; just lock it in (no trailing ghost anchor to drop).
			this.finishedPlacing = true
			this.updateTheme()
			this.update()
			return
		}
		if (this.referencePoints.length == 0) {
			this.placeStep(new SVG.Point())
		}

		// drop the trailing "ghost" anchor that was tracking the cursor
		this.referencePoints.pop()
		this.anchors.pop()
		if (
			this.referencePoints.length >= 2 &&
			this.referencePoints.at(-1).eq(this.referencePoints.at(-2))
		) {
			this.referencePoints.pop()
			this.anchors.pop()
		}

		if (this.referencePoints.length < 2) {
			MainController.instance.removeComponent(this)
			return
		}

		this.regenerateDefaultHandles()
		this.finishedPlacing = true
		this.updateTheme()
		this.update()
	}

	/**
	 * Give freshly-inserted anchors a usable handle pair so the curve isn't a polyline of
	 * straight kinks the moment the user finishes placement. Leaves anchors that already have
	 * a non-zero handle alone.
	 *
	 * Handle direction at an interior anchor uses the Catmull-Rom-ish trick: take the chord
	 * from the previous anchor to the next anchor, normalise it, and lay equal-magnitude
	 * tangents along that chord direction. This produces smoother default curves than the
	 * older "point straight at the neighbour" rule, especially when the polyline of anchors
	 * has a kink at every vertex.
	 */
	private regenerateDefaultHandles() {
		for (let i = 0; i < this.anchors.length; i++) {
			const anchor = this.anchors[i]
			const prev = this.anchors[i - 1]
			const next = this.anchors[i + 1]

			// Endpoints: a single handle pointing one third of the way to the only neighbour.
			if (i === 0 && next) {
				if (!anchor.outHandle || anchor.outHandle.abs() === 0) {
					anchor.outHandle = next.position.sub(anchor.position).div(3)
				}
				continue
			}
			if (i === this.anchors.length - 1 && prev) {
				if (!anchor.inHandle || anchor.inHandle.abs() === 0) {
					anchor.inHandle = prev.position.sub(anchor.position).div(3)
				}
				continue
			}

			// Interior anchor: tangent along the prev→next chord, length 1/6 of each leg
			// (matches Catmull-Rom's natural smoothing for evenly-spaced anchors).
			if (prev && next) {
				const chord = next.position.sub(prev.position)
				const chordLen = chord.abs()
				if (chordLen < HANDLE_KEY_INSET) continue
				const tangent = chord.div(chordLen)
				// Keep the Catmull-Rom-ish length but never below ~1/5 of the leg, so a fresh handle
				// is always clearly off its anchor instead of stacked on top of it (easier to grab).
				const inLeg = Math.max(anchor.position.sub(prev.position).abs() / 6, anchor.position.sub(prev.position).abs() * 0.2)
				const outLeg = Math.max(next.position.sub(anchor.position).abs() / 6, next.position.sub(anchor.position).abs() * 0.2)
				if (!anchor.inHandle || anchor.inHandle.abs() === 0) {
					anchor.inHandle = tangent.mul(-inLeg)
				}
				if (!anchor.outHandle || anchor.outHandle.abs() === 0) {
					anchor.outHandle = tangent.mul(outLeg)
				}
			}
		}
		// endpoints lose the unused side
		if (this.anchors.length > 0) {
			this.anchors[0].inHandle = null
			this.anchors[this.anchors.length - 1].outHandle = null
		}
		this.invalidateGeometry()
	}

	/** Drop any cached geometry derived from anchors. Call after any anchor / handle mutation. */
	private invalidateGeometry() {
		this.pathStringCache = null
		this.bboxCache = null
		this.polylineCache = null
	}

	/**
	 * Schedule a render on the next animation frame, coalescing repeated mutations within
	 * the same frame into a single SVG plot. Used by handle-drag callbacks where each
	 * mousemove can trigger several mutations (move + continuity-enforce + selection visual).
	 */
	private scheduleUpdate() {
		if (this.updateScheduled) return
		this.updateScheduled = true
		requestAnimationFrame(() => {
			this.updateScheduled = false
			this.update()
		})
	}

	public update(): void {
		if (this.referencePoints.length === 0) {
			this.curve.plot("")
			this.dragCurve.plot("")
			return
		}

		// Mirror referencePoints into anchors so PathComponent's drag-on-anchor path keeps working.
		for (let i = 0; i < this.anchors.length && i < this.referencePoints.length; i++) {
			if (!this.anchors[i].position.eq(this.referencePoints[i])) {
				this.anchors[i].position = this.referencePoints[i]
				this.invalidateGeometry()
			}
		}

		const path = this.pathStringCache ?? (this.pathStringCache = this.buildPathString())
		this.curve.plot(path)
		this.dragCurve.plot(path)

		if (!this.bboxCache) this.bboxCache = bboxFromPoints(this.referencePoints)
		this._bbox = this.bboxCache
		this.position = new SVG.Point(this._bbox.cx, this._bbox.cy)

		// snapping: the anchors themselves, no extras for now.
		if (this.snappingPoints.length === this.referencePoints.length) {
			for (let i = 0; i < this.snappingPoints.length; i++) {
				this.snappingPoints[i].updateRelPosition(this.referencePoints[i])
			}
		} else {
			this.snappingPoints = this.referencePoints.map(
				(p, i) =>
					new SnapPoint(
						this,
						i === 0 ? "START"
						: i === this.referencePoints.length - 1 ? "END"
						: "",
						p
					)
			)
		}

		this.recalculateSelectionVisuals()
		this.recalculateSnappingPoints()
		this.recalculateResizePoints()
		this.recalculateHandleOverlay()
	}

	private buildPathString(): string {
		if (this.anchors.length < 2) {
			return ""
		}
		const segs: string[] = []
		const first = this.anchors[0]
		segs.push(`M ${first.position.x} ${first.position.y}`)
		for (let i = 1; i < this.anchors.length; i++) {
			const prev = this.anchors[i - 1]
			const curr = this.anchors[i]
			const c1 = prev.outHandle ? prev.position.add(prev.outHandle) : prev.position
			const c2 = curr.inHandle ? curr.position.add(curr.inHandle) : curr.position
			segs.push(`C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${curr.position.x} ${curr.position.y}`)
		}
		return segs.join(" ")
	}

	private recalculateHandleOverlay() {
		if (!this.handleOverlay) return
		const transformMatrix = this.getTransformMatrix()

		let dotIdx = 0
		let lineIdx = 0
		for (let i = 0; i < this.anchors.length; i++) {
			const a = this.anchors[i]
			// Declutter: when an anchor is focused (hovered or dragged) only its handles stay fully
			// visible; the rest dim but never disappear, so nothing is lost and overlapping points
			// from different anchors stop fighting for the cursor. -1 = nothing focused yet = all on.
			const emphasized = this.activeAnchor < 0 || i === this.activeAnchor
			for (const side of ["in", "out"] as const) {
				const handle = side === "in" ? a.inHandle : a.outHandle
				if (!handle) continue
				const anchorAbs = a.position.transform(transformMatrix)
				const handleAbs = a.position.add(handle).transform(transformMatrix)

				this.handleHandles[dotIdx]?.center(handleAbs.x, handleAbs.y)
				this.handleHandles[dotIdx]?.opacity(emphasized ? 1 : 0.3)
				this.handleLines[lineIdx]?.plot(anchorAbs.x, anchorAbs.y, handleAbs.x, handleAbs.y)
				this.handleLines[lineIdx]?.stroke({ opacity: emphasized ? 0.6 : 0.15 })
				dotIdx++
				lineIdx++
			}
		}
	}

	protected recalculateResizePoints() {
		const transformMatrix = this.getTransformMatrix()
		for (let i = 0; i < this.resizableSVGs.length; i++) {
			const point = this.referencePoints[i].transform(transformMatrix)
			this.resizableSVGs[i].center(point.x, point.y)
		}
	}

	protected recalculateSelectionVisuals(): void {
		if (!this.selectionElement) return
		const strokeWidth = this.strokeInfo.width.convertToUnit("px").value
		const bbox = new SVG.Box(
			this._bbox.x - strokeWidth / 2,
			this._bbox.y - strokeWidth / 2,
			this._bbox.w + strokeWidth,
			this._bbox.h + strokeWidth
		)
		this.selectionElement.size(bbox.width + selectedBoxWidth, bbox.height + selectedBoxWidth)
		this.selectionElement.center(bbox.cx, bbox.cy)
		this.selectionElement.transform(this.getTransformMatrix())
	}

	public isInsideSelectionRectangle(selectionRectangle: SVG.Box): boolean {
		const transformMatrix = this.getTransformMatrix()
		// Sample each segment as a 12-segment polyline; cheap and good enough for the picker.
		for (let i = 1; i < this.anchors.length; i++) {
			const prev = this.anchors[i - 1]
			const curr = this.anchors[i]
			const c1 = prev.outHandle ? prev.position.add(prev.outHandle) : prev.position
			const c2 = curr.inHandle ? curr.position.add(curr.inHandle) : curr.position
			for (let s = 0; s <= 12; s++) {
				const t = s / 12
				const p = SplineComponent.evalCubic(prev.position, c1, c2, curr.position, t).transform(transformMatrix)
				if (
					p.x >= selectionRectangle.x &&
					p.x <= selectionRectangle.x + selectionRectangle.width &&
					p.y >= selectionRectangle.y &&
					p.y <= selectionRectangle.y + selectionRectangle.height
				) {
					return true
				}
			}
		}
		return false
	}

	public rotate(angleDeg: number): void {
		this.referencePoints = this.referencePoints.map((p) => p.rotate(angleDeg, this.position))
		const c = Math.cos((angleDeg * Math.PI) / 180)
		const s = Math.sin((angleDeg * Math.PI) / 180)
		const rot = (v: SVG.Point) => new SVG.Point(v.x * c - v.y * s, v.x * s + v.y * c)
		for (const a of this.anchors) {
			a.position = a.position.rotate(angleDeg, this.position)
			if (a.inHandle) a.inHandle = rot(a.inHandle)
			if (a.outHandle) a.outHandle = rot(a.outHandle)
		}
		this.invalidateGeometry()
		this.update()
	}

	public flip(horizontalAxis: boolean): void {
		const flip = (v: SVG.Point) =>
			horizontalAxis ? new SVG.Point(v.x, -v.y) : new SVG.Point(-v.x, v.y)
		for (let i = 0; i < this.anchors.length; i++) {
			const a = this.anchors[i]
			const rel = a.position.sub(this.position)
			a.position = this.position.add(flip(rel))
			if (a.inHandle) a.inHandle = flip(a.inHandle)
			if (a.outHandle) a.outHandle = flip(a.outHandle)
			this.referencePoints[i] = a.position
		}
		this.invalidateGeometry()
		this.update()
	}

	public toJson(): SplineSaveObject {
		const data = super.toJson() as SplineSaveObject
		data.type = SplineComponent.jsonID
		data.anchors = this.anchors.map((a) => ({
			position: { x: roundTo(a.position.x, 3), y: roundTo(a.position.y, 3) },
			inHandle: a.inHandle ? { x: roundTo(a.inHandle.x, 3), y: roundTo(a.inHandle.y, 3) } : null,
			outHandle:
				a.outHandle ? { x: roundTo(a.outHandle.x, 3), y: roundTo(a.outHandle.y, 3) } : null,
			continuity: a.continuity,
		}))
		return data
	}

	public applyJson(saveObject: SplineSaveObject): void {
		super.applyJson(saveObject)

		// Legacy save files won't carry `anchors`; fall back to building a corner-only spline from
		// `points` so we don't crash on round-tripping a wire that the user later turned into a spline.
		if (saveObject.anchors && saveObject.anchors.length >= 2) {
			this.anchors = saveObject.anchors.map((a) => ({
				position: new SVG.Point(a.position),
				inHandle: a.inHandle ? new SVG.Point(a.inHandle) : null,
				outHandle: a.outHandle ? new SVG.Point(a.outHandle) : null,
				continuity: a.continuity ?? "corner",
			}))
			this.referencePoints = this.anchors.map((a) => a.position.clone())
		} else if (this.referencePoints.length >= 2) {
			this.anchors = this.referencePoints.map((p, i) => ({
				position: p.clone(),
				inHandle: null,
				outHandle: null,
				continuity: "corner" as SplineContinuity,
			}))
			this.regenerateDefaultHandles()
		}

		this.invalidateGeometry()
		this.updateTheme()
		this.update()
	}

	static fromJson(saveObject: SplineSaveObject): SplineComponent {
		if (
			(!saveObject.anchors || saveObject.anchors.length < 2) &&
			(!saveObject.points || saveObject.points.length < 2)
		) {
			return null
		}
		// Pre-0.9.2 save files don't have anchors; the applyJson path above takes care of them.
		void SaveController.instance.currentlyLoadedSaveVersion
		return new SplineComponent()
	}

	protected buildTikzCommand(command: TikzPathCommand): void {
		super.buildTikzCommand(command)

		// Emit (P0) .. controls (C1) and (C2) .. (P1) .. controls (C3) and (C4) .. (P2) ...
		// The TikzPathCommand contract puts coordinates and connectors into parallel arrays:
		// coordinates[i] connector[i] coordinates[i+1] connector[i+1] coordinates[i+2] ...
		command.coordinates.length = 0
		command.connectors.length = 0
		if (this.anchors.length < 2) return

		command.coordinates.push(this.anchors[0].position)
		for (let i = 1; i < this.anchors.length; i++) {
			const prev = this.anchors[i - 1]
			const curr = this.anchors[i]
			const c1 = prev.outHandle ? prev.position.add(prev.outHandle) : prev.position
			const c2 = curr.inHandle ? curr.position.add(curr.inHandle) : curr.position
			command.connectors.push(`.. controls ${c1.toTikzString()} and ${c2.toTikzString()} ..`)
			command.coordinates.push(curr.position)
		}
	}

	public copyForPlacement(): SplineComponent {
		return new SplineComponent()
	}

	public remove(): void {
		this.detachDragHandlers()
		this.visualization.remove()
		this.viewSelected(false)
		this.selectionElement?.remove()
		if (this.finishedPlacing) {
			this.draggable(false)
		}
	}

	private static evalCubic(p0: SVG.Point, p1: SVG.Point, p2: SVG.Point, p3: SVG.Point, t: number) {
		const u = 1 - t
		return new SVG.Point(
			u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
			u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y
		)
	}
}

function roundTo(value: number, digits: number): number {
	const factor = 10 ** digits
	return Math.round(value * factor) / factor
}

