import { CanvasController, EditableProperty, Undo } from "../internal"

export class TextProperty extends EditableProperty<string> {
	private input: HTMLInputElement
	private invalidDiv: HTMLDivElement

	private label: string

	private validator = (value: string) => ""

	public constructor(
		label: string,
		initalValue?: string,
		tooltip = "",
		validator = (value: string) => "",
		id: string = ""
	) {
		super(initalValue, tooltip, id)
		this.label = label
		this.validator = validator
	}

	public buildHTML(): HTMLElement {
		let row = this.getRow()

		let inputDiv = document.createElement("div") as HTMLDivElement
		inputDiv.classList.add("col", "col-md-12", "my-0", "input-group", "has-validation")
		{
			let labelSpan = document.createElement("span") as HTMLSpanElement
			labelSpan.classList.add("input-group-text")
			labelSpan.innerHTML = this.label ?? ""
			inputDiv.appendChild(labelSpan)

			this.input = document.createElement("input") as HTMLInputElement
			this.input.classList.add("form-control")
			this.input.setAttribute("type", "text")
			this.input.value = this.value ?? ""
			inputDiv.appendChild(this.input)

			this.invalidDiv = document.createElement("div") as HTMLDivElement
			this.invalidDiv.classList.add("col-12", "invalid-feedback", "d-none")
			inputDiv.appendChild(this.invalidDiv)
		}
		row.appendChild(inputDiv)

		this.input.addEventListener("mousedown", (ev) => {
			CanvasController.instance.draggingFromInput = this.input
		})

		let previousState = ""
		this.input.addEventListener("focusin", (ev) => {
			previousState = this.value ?? ""
		})
		this.input.addEventListener("input", (ev) => {
			let validationText = this.validator(this.input.value)
			this.changeInvalidStatus(validationText)
			if (validationText == "") {
				this.updateValue(this.input.value)
			}
		})

		this.input.addEventListener("focusout", (ev) => {
			//first set what you see to the last known value, which should always be a valid value
			this.updateHTML()
			this.changeInvalidStatus("")
			if (this.value && previousState !== this.value) {
				Undo.instance.addState()
			}
		})
		return row
	}

	protected disable(disabled = true): void {
		this.input.disabled = disabled
	}

	private changeInvalidStatus(msg: string) {
		if (this.invalidDiv) {
			if (msg === "") {
				this.input.classList.remove("is-invalid")
				this.invalidDiv.classList.add("d-none")
				this.invalidDiv.innerHTML = ""
			} else {
				this.input.classList.add("is-invalid")
				this.input.classList.add("is-invalid")
				this.invalidDiv.classList.remove("d-none")
				this.invalidDiv.innerHTML = "Invalid! " + msg
			}
		}
	}

	public updateHTML(): void {
		if (this.input) {
			this.input.value = this.value
		}
	}

	public eq(first: string, second: string): boolean {
		return first == second
	}

	protected clone(value: string, allEqual: boolean): TextProperty {
		return new TextProperty(this.label, allEqual ? value : "*", this.tooltip, this.validator, this.id)
	}

	// Custom override: TextProperty needs to surface a per-result validation message when the
	// fanned-out values fail any individual property's validator. The default fan-out doesn't
	// know to call `changeInvalidStatus` on the multi-edit instance.
	public getMultiEditVersion(properties: TextProperty[]): TextProperty {
		const allEqual = this.equivalent(properties)
		const result = this.clone(this.value, allEqual)
		result.addChangeListener((ev) => {
			let invalid = false
			for (const property of properties) {
				property.updateValue(ev.value, true, true)
				if (!invalid && property.validator(ev.value) != "") {
					invalid = true
				}
			}
			if (invalid) {
				result.changeInvalidStatus("Multi-edit with invalid values! Adjust individual component fields.")
			}
		})
		return result
	}
}
