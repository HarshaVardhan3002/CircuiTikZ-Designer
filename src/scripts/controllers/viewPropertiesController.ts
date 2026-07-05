import * as SVG from "@svgdotjs/svg.js"
import {
	BooleanProperty,
	ButtonGridProperty,
	CanvasController,
	InfoProperty,
	SectionHeaderProperty,
	SliderProperty,
	t,
} from "../internal"

/**
 * Builds and owns the "view properties" panel: reset/fit buttons, enable-grid switch,
 * grid cell size and subdivisions sliders, and the current grid spacing read-out.
 *
 * Originally these were hand-written Bootstrap markup in `index.html` with hand-wired
 * listeners in `PropertyController.setFormView`, which re-attached on every panel open
 * (audit C4) and produced two parallel UI patterns (audit I5). Now they are regular
 * `EditableProperty` instances built once and re-appended to `#view-properties` whenever
 * the panel is shown.
 *
 * The grid-visibility BooleanProperty also keeps a hidden helper `<input id="gridVisible">`
 * in sync, because `CanvasController` reads/writes that input directly. We do not modify
 * `CanvasController`; instead, the helper input mirrors the BooleanProperty so the existing
 * change listener and `setSettings` round-trip keep working unchanged.
 */
export class ViewPropertiesController {
	private static _instance: ViewPropertiesController
	public static get instance(): ViewPropertiesController {
		if (!ViewPropertiesController._instance) {
			ViewPropertiesController._instance = new ViewPropertiesController()
		}
		return ViewPropertiesController._instance
	}

	private container: HTMLDivElement

	private viewActions: ButtonGridProperty
	private gridVisibleProp: BooleanProperty
	private cellSizeProp: SliderProperty
	private subdivisionsProp: SliderProperty
	private gridSpacingInfo: InfoProperty

	/** Hidden checkbox `CanvasController` queries by id `gridVisible`. */
	private hiddenGridVisibleInput: HTMLInputElement

	private htmlElement: HTMLDivElement
	/** Suppresses re-entrant updates while we sync the hidden input both ways. */
	private syncingGridVisible = false

	private constructor() {
		// Reset / Fit view as a 2-col button grid.
		this.viewActions = new ButtonGridProperty(
			2,
			[
				[t("props.resetView"), ""],
				[t("props.fitView"), ""],
			],
			[
				() => CanvasController.instance.resetView(),
				() => CanvasController.instance.fitView(),
			],
			false,
			[t("props.resetView"), t("props.fitView")]
		)

		// The grid-visibility checkbox is mirrored to a hidden `#gridVisible` input that
		// already exists in `index.html`. CanvasController binds a 'change' listener to it
		// during its own construction (which runs BEFORE PropertyController is instantiated),
		// so the input has to be present in the static markup rather than created here.
		// We can't touch CanvasController, so we route both ways through this helper input.
		this.hiddenGridVisibleInput = document.getElementById("gridVisible") as HTMLInputElement

		this.gridVisibleProp = new BooleanProperty(
			t("props.enableGrid"),
			this.hiddenGridVisibleInput?.checked ?? true
		)
		this.gridVisibleProp.addChangeListener((ev) => {
			if (this.syncingGridVisible) return
			this.syncingGridVisible = true
			try {
				this.hiddenGridVisibleInput.checked = !!ev.value
				// Fire the change event so CanvasController's existing listener runs.
				this.hiddenGridVisibleInput.dispatchEvent(new Event("change"))
			} finally {
				this.syncingGridVisible = false
			}
		})

		// If anything else flips the hidden input directly (e.g. CanvasController.setSettings
		// during tab restore), pull the new value back into the BooleanProperty.
		this.hiddenGridVisibleInput.addEventListener("change", () => {
			if (this.syncingGridVisible) return
			this.syncingGridVisible = true
			try {
				this.gridVisibleProp.updateValue(this.hiddenGridVisibleInput.checked, true, false)
			} finally {
				this.syncingGridVisible = false
			}
		})

		// Grid cell size slider (cm). Step matches the original `<input type="range">`
		// default of 1 (was implicit in the hand-written HTML).
		this.cellSizeProp = new SliderProperty(
			t("props.gridCellSize"),
			1,
			5,
			1,
			new SVG.Number(CanvasController.instance.majorGridSizecm, "cm"),
			true
		)
		this.cellSizeProp.addChangeListener((ev) => {
			this.applyGrid(ev.value.value, this.subdivisionsProp.value.value)
		})

		// Subdivisions slider (count).
		this.subdivisionsProp = new SliderProperty(
			t("props.gridSubdivisions"),
			1,
			10,
			1,
			new SVG.Number(CanvasController.instance.majorGridSubdivisions),
			true
		)
		this.subdivisionsProp.addChangeListener((ev) => {
			this.applyGrid(this.cellSizeProp.value.value, ev.value.value)
		})

		// Read-only "current grid spacing" pill.
		this.gridSpacingInfo = new InfoProperty(t("props.currentGridSpacing"))
		this.refreshSpacingInfo(
			CanvasController.instance.majorGridSizecm,
			CanvasController.instance.majorGridSubdivisions
		)

		// Re-translate labels on locale change. Only the InfoProperty value actually changes here;
		// the other properties' labels were captured at construction. To keep them current we
		// re-build the panel structure on locale change.
		window.addEventListener("locale-changed", () => this.rebuild())
	}

	/**
	 * Returns the wrapper element that holds all view properties. Built lazily and reused.
	 * Caller is responsible for placing it in the DOM (see `appendInto`).
	 */
	public getHTML(): HTMLDivElement {
		if (!this.htmlElement) {
			this.htmlElement = document.createElement("div") as HTMLDivElement
			this.htmlElement.id = "viewPropertiesView"
			this.htmlElement.classList.add("container-fluid", "w-100", "m-0", "gap-3", "px-0")
			this.populate(this.htmlElement)
		}
		return this.htmlElement
	}

	/**
	 * Append this panel's content into the given container. The hidden `#gridVisible`
	 * backing input lives in `index.html` and is unrelated to this container.
	 */
	public appendInto(container: HTMLDivElement): void {
		this.container = container
		const html = this.getHTML()
		if (html.parentElement !== container) {
			container.appendChild(html)
		}
	}

	/**
	 * Re-sync the displayed values from the current canvas state. Cheap; safe to call on
	 * every panel open. Does NOT re-attach listeners (that's what fixes audit C4).
	 */
	public syncFromCanvas(): void {
		const cellSize = CanvasController.instance.majorGridSizecm
		const subdivisions = CanvasController.instance.majorGridSubdivisions
		const visible = CanvasController.instance.gridVisible

		this.cellSizeProp.updateValue(new SVG.Number(cellSize, "cm"), true, false)
		this.subdivisionsProp.updateValue(new SVG.Number(subdivisions), true, false)
		this.gridVisibleProp.updateValue(visible, true, false)
		this.hiddenGridVisibleInput.checked = visible
		this.refreshSpacingInfo(cellSize, subdivisions)
	}

	private applyGrid(majorSizecm: number, majorSubdivisions: number): void {
		CanvasController.instance.changeGrid(majorSizecm, majorSubdivisions)
		this.refreshSpacingInfo(majorSizecm, majorSubdivisions)
	}

	private refreshSpacingInfo(majorSizecm: number, majorSubdivisions: number): void {
		const spacing = (majorSizecm / majorSubdivisions).toLocaleString(undefined, {
			maximumFractionDigits: 2,
		})
		this.gridSpacingInfo.updateValue(`${spacing} cm`, true, false)
	}

	private populate(container: HTMLDivElement): void {
		container.appendChild(this.viewActions.getHTMLElement())
		container.appendChild(new SectionHeaderProperty(t("props.enableGrid")).getHTMLElement())
		container.appendChild(this.gridVisibleProp.getHTMLElement())
		container.appendChild(this.cellSizeProp.getHTMLElement())
		container.appendChild(this.subdivisionsProp.getHTMLElement())
		container.appendChild(this.gridSpacingInfo.getHTMLElement())
	}

	/**
	 * Rebuild the panel after a locale change. Only safe to call if the panel is currently
	 * visible (i.e. `htmlElement` is already in the DOM); otherwise we just discard and
	 * defer to the next `appendInto`.
	 */
	private rebuild(): void {
		if (!this.htmlElement) return
		// Remove all child nodes from the wrapper, then repopulate. Existing property
		// instances rebuild their own HTML lazily via `getHTMLElement`.
		// We can't call removeHTMLElement on the existing properties because that would
		// drop their listeners; instead we recreate fresh i18n labels on a new instance
		// of each property.
		this.htmlElement.innerHTML = ""

		// ButtonGridProperty labels are captured at construction time, so we rebuild it.
		const oldActions = this.viewActions
		this.viewActions = new ButtonGridProperty(
			2,
			[
				[t("props.resetView"), ""],
				[t("props.fitView"), ""],
			],
			[
				() => CanvasController.instance.resetView(),
				() => CanvasController.instance.fitView(),
			],
			false,
			[t("props.resetView"), t("props.fitView")]
		)
		oldActions.remove()

		// SliderProperty / BooleanProperty / InfoProperty all carry their label as a
		// constructor field with no setter; rebuild them too so their labels re-translate.
		const visible = this.gridVisibleProp.value ?? CanvasController.instance.gridVisible
		const cellSize = this.cellSizeProp.value?.value ?? CanvasController.instance.majorGridSizecm
		const subdivisions =
			this.subdivisionsProp.value?.value ?? CanvasController.instance.majorGridSubdivisions

		this.gridVisibleProp = new BooleanProperty(t("props.enableGrid"), visible)
		this.gridVisibleProp.addChangeListener((ev) => {
			if (this.syncingGridVisible) return
			this.syncingGridVisible = true
			try {
				this.hiddenGridVisibleInput.checked = !!ev.value
				this.hiddenGridVisibleInput.dispatchEvent(new Event("change"))
			} finally {
				this.syncingGridVisible = false
			}
		})

		this.cellSizeProp = new SliderProperty(
			t("props.gridCellSize"),
			1,
			5,
			1,
			new SVG.Number(cellSize, "cm"),
			true
		)
		this.cellSizeProp.addChangeListener((ev) => {
			this.applyGrid(ev.value.value, this.subdivisionsProp.value.value)
		})

		this.subdivisionsProp = new SliderProperty(
			t("props.gridSubdivisions"),
			1,
			10,
			1,
			new SVG.Number(subdivisions),
			true
		)
		this.subdivisionsProp.addChangeListener((ev) => {
			this.applyGrid(this.cellSizeProp.value.value, ev.value.value)
		})

		this.gridSpacingInfo = new InfoProperty(t("props.currentGridSpacing"))
		this.refreshSpacingInfo(cellSize, subdivisions)

		this.populate(this.htmlElement)
	}
}
