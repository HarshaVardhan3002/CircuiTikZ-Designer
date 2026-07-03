import {
	AlignmentMode,
	buildRotateFlipGrid,
	ButtonGridProperty,
	CanvasController,
	CircuitComponent,
	DistributionMode,
	EditableProperty,
	EnvironmentVariableController,
	GroupComponent,
	MainController,
	SectionHeaderProperty,
	SelectionController,
	Undo,
	ViewPropertiesController,
	t,
} from "../internal"

export type FormEntry = {
	originalObject: object
	propertyName: string
	inputType: string
	currentValue: any
}

export enum PropertyCategories {
	manipulation,
	ordering,
	options,
	fill,
	stroke,
	label,
	voltage,
	current,
	text,
	info,
}

export class PropertiesCollection extends Map<PropertyCategories, EditableProperty<any>[]> {
	public add(category: PropertyCategories, property: EditableProperty<any>) {
		if (this.has(category)) {
			this.get(category).push(property)
		} else {
			this.set(category, [property])
		}
	}

	public sorted(): EditableProperty<any>[] {
		let properties: EditableProperty<any>[] = []

		let key = Object.keys(PropertyCategories)[0]
		PropertyCategories[key]
		for (const element in PropertyCategories) {
			if (isNaN(Number(element))) {
				//@ts-ignore
				let category: PropertyCategories = PropertyCategories[element]
				if (this.has(category)) {
					properties.push(...this.get(category))
				}
			}
		}
		return properties
	}
}

export class PropertyController {
	private static _instance: PropertyController
	public static get instance(): PropertyController {
		if (!PropertyController._instance) {
			PropertyController._instance = new PropertyController()
		}
		return PropertyController._instance
	}

	private viewProperties: HTMLDivElement
	private propertiesEntries: HTMLDivElement
	private propertiesTitle: HTMLElement

	private multies: EditableProperty<any>[] = []

	/** True once the view-properties panel has been built into the DOM. */
	private viewPropertiesBuilt = false

	private constructor() {
		this.propertiesTitle = document.getElementById("propertiesTitle") as HTMLElement
		this.viewProperties = document.getElementById("view-properties") as HTMLDivElement
		this.propertiesEntries = document.getElementById("propertiesEntries") as HTMLDivElement

		// Pre-build the view-properties panel exactly once. The container starts empty in
		// the HTML; we populate it with: design name, ViewPropertiesController panel
		// (reset/fit, enable-grid, sliders, current spacing), and the EnvironmentVariableController.
		// All listeners live on the property instances themselves and are attached only once
		// here - fixing audit C4 (slider listeners no longer pile up on every panel open).
		this.buildViewPropertiesPanel()

		// Re-render the panel on language change so the title and any open form text re-translate.
		window.addEventListener("locale-changed", () => this.update())
	}

	private buildViewPropertiesPanel(): void {
		if (this.viewPropertiesBuilt) return
		this.viewPropertiesBuilt = true

		// Design name input goes first.
		this.viewProperties.appendChild(MainController.instance.designName.getHTMLElement())

		// Reset/fit, enable-grid switch, grid sliders, current spacing - all built as
		// real Property instances by ViewPropertiesController.
		ViewPropertiesController.instance.appendInto(this.viewProperties)

		// Environment-variable presets and choices.
		this.viewProperties.appendChild(EnvironmentVariableController.instance.getHTML())
	}

	update() {
		let components = SelectionController.instance.currentlySelectedComponents
		this.clearForm()

		if (components.length > 1) {
			this.setMultiForm(components)
		} else if (components.length === 1) {
			this.setForm(components[0])
		} else {
			this.setFormView()
		}

		MainController.instance.updateTooltips()
	}

	private setMultiForm(components: CircuitComponent[]) {
		this.propertiesEntries.classList.remove("d-none")
		this.propertiesTitle.innerText = t("props.selection")

		let rows: HTMLElement[] = []
		// (rotate/flip grid extracted to rotateFlipGrid.ts)
		const positioning = buildRotateFlipGrid(
			{
				rotate: (d) => SelectionController.instance.rotateSelection(d),
				flip: (h) => SelectionController.instance.flipSelection(h),
			},
			[
				"Rotate the components 90 degrees clockwise",
				"Rotate the components 90 degrees counter clockwise",
				"Rotate the components 45 degrees clockwise",
				"Rotate the components 45 degrees counter clockwise",
				"Flip the components around its x-axis",
				"Flip the components around its y-axis",
			]
		)
		rows.push(positioning.buildHTML())

		rows.push(new SectionHeaderProperty("Ordering").buildHTML())
		let ordering = new ButtonGridProperty(
			2,
			[
				["Foreground", ""],
				["Background", ""],
				["Forward", ""],
				["Backward", ""],
			],
			[
				(ev) =>
					CanvasController.instance.componentsToForeground(
						SelectionController.instance.currentlySelectedComponents
					),
				(ev) =>
					CanvasController.instance.componentsToBackground(
						SelectionController.instance.currentlySelectedComponents
					),
				(ev) =>
					CanvasController.instance.moveComponentsForward(
						SelectionController.instance.currentlySelectedComponents
					),
				(ev) =>
					CanvasController.instance.moveComponentsBackward(
						SelectionController.instance.currentlySelectedComponents
					),
			],
			false,
			[
				"Bring the components to the foreground",
				"Move the components to the background",
				"Move the components one step towards the foreground",
				"Move the components one step towards the background",
			]
		)
		rows.push(ordering.buildHTML())

		rows.push(new SectionHeaderProperty("Grouping").buildHTML())
		let grouping = new ButtonGridProperty(
			1,
			[["Group", ""]],
			[(ev) => GroupComponent.group(SelectionController.instance.currentlySelectedComponents)]
		)
		rows.push(grouping.buildHTML())

		rows.push(new SectionHeaderProperty("Align").buildHTML())
		let alignment = new ButtonGridProperty(
			3,
			[
				["", "align_horizontal_left"],
				["", "align_horizontal_center"],
				["", "align_horizontal_right"],
				["", "align_vertical_top"],
				["", "align_vertical_center"],
				["", "align_vertical_bottom"],
			],
			[
				(ev) => SelectionController.instance.alignSelection(AlignmentMode.START, true),
				(ev) => SelectionController.instance.alignSelection(AlignmentMode.CENTER, true),
				(ev) => SelectionController.instance.alignSelection(AlignmentMode.END, true),
				(ev) => SelectionController.instance.alignSelection(AlignmentMode.START, false),
				(ev) => SelectionController.instance.alignSelection(AlignmentMode.CENTER, false),
				(ev) => SelectionController.instance.alignSelection(AlignmentMode.END, false),
			]
		)
		rows.push(alignment.buildHTML())

		rows.push(new SectionHeaderProperty("Distribute").buildHTML())
		let distribute = new ButtonGridProperty(
			2,
			[
				["Center", "horizontal_distribute"],
				["Spacing", "align_justify_space_even"],
				["Center", "vertical_distribute"],
				["Spacing", "align_space_even"],
			],
			[
				(ev) => SelectionController.instance.distributeSelection(DistributionMode.CENTER, true),
				(ev) => SelectionController.instance.distributeSelection(DistributionMode.SPACE, true),
				(ev) => SelectionController.instance.distributeSelection(DistributionMode.CENTER, false),
				(ev) => SelectionController.instance.distributeSelection(DistributionMode.SPACE, false),
			]
		)
		rows.push(distribute.buildHTML())

		this.propertiesEntries.append(...rows)

		const overlappingProperties: PropertiesCollection = new PropertiesCollection()
		this.multies = []

		let key = Object.keys(PropertyCategories)[0]
		PropertyCategories[key]
		// repeat overlap detection for all possible categories
		for (const element in PropertyCategories) {
			if (!isNaN(Number(element))) {
				continue
			}
			//@ts-ignore
			let category: PropertyCategories = PropertyCategories[element]
			const categoryMap: Map<string, EditableProperty<any>[]> = new Map()

			// in each category, loop over all components
			for (const component of components) {
				const properties = component.properties.get(category)
				if (properties == undefined) {
					continue
				}
				// keep track of all properties of a given id
				for (const property of properties) {
					if (property.id == "") {
						//skip empty ids
						continue
					}
					if (categoryMap.has(property.id)) {
						categoryMap.get(property.id).push(property)
					} else {
						categoryMap.set(property.id, [property])
					}
				}
			}
			const relevantProperties: EditableProperty<any>[] = []
			// remove all properties, which are not present in every component, otherwise add properties
			for (const id of categoryMap.keys()) {
				const properties = categoryMap.get(id)
				if (properties.length < components.length) {
					categoryMap.set(id, [])
				} else {
					// get the multi edit version and save for housekeeping
					const multi = properties[0].getMultiEditVersion(properties)

					this.multies.push(multi)

					relevantProperties.push(multi)
				}
			}
			overlappingProperties.set(category, relevantProperties)
		}
		this.propertiesEntries.append(...overlappingProperties.sorted().map((property) => property.getHTMLElement()))
	}

	private setForm(component: CircuitComponent) {
		this.propertiesEntries.classList.remove("d-none")
		this.propertiesTitle.innerText = component.displayName
		this.propertiesEntries.append(...component.properties.sorted().map((property) => property.getHTMLElement()))
	}

	/**
	 * Show the view-properties panel and refresh the displayed values from the canvas.
	 *
	 * Trivial after I5/C4: the panel is built once in the constructor; here we just
	 * un-hide it and ask `ViewPropertiesController` to re-sync sliders / toggle / spacing
	 * from the live `CanvasController` state. No listeners are added here.
	 */
	private setFormView() {
		this.viewProperties.classList.remove("d-none")
		this.propertiesTitle.innerText = t("props.generalSettings")
		ViewPropertiesController.instance.syncFromCanvas()
	}

	/**
	 * Public hook used by `CanvasController.setSettings` after a tab restore. We just
	 * forward to `ViewPropertiesController` (which also calls `CanvasController.changeGrid`
	 * via its own listeners) and let it own the slider-render path.
	 */
	public setSliderValues(majorSizecm: number, majorSubdivisions: number) {
		// CanvasController already updated its own majorGridSizecm/majorGridSubdivisions
		// fields before calling this. Push the new values through changeGrid so the SVG
		// grid pattern is rebuilt, then re-sync the visible slider values.
		CanvasController.instance.changeGrid(majorSizecm, majorSubdivisions)
		ViewPropertiesController.instance.syncFromCanvas()
	}

	private clearForm() {
		for (const element of this.multies) {
			element.remove()
		}
		this.propertiesTitle.innerText = t("props.title")
		this.viewProperties.classList.add("d-none")
		this.propertiesEntries.classList.add("d-none")
		this.propertiesEntries.innerText = ""

		while (this.propertiesEntries.lastElementChild) {
			this.propertiesEntries.removeChild(this.propertiesEntries.lastElementChild)
		}
	}
}
