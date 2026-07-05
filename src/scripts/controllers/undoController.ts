import {
	MainController,
	SelectionController,
	SaveController,
	SelectionMode,
	SaveFileFormat,
	currentSaveVersion,
	GlobalTikzSettings,
	EnvironmentVariableController,
} from "../internal"

/**
 * Class handling undo and redo via save states
 * @class
 */
export class Undo {
	private static _instance: Undo
	public static get instance(): Undo {
		if (!Undo._instance) {
			Undo._instance = new Undo()
		}
		return Undo._instance
	}

	private states: SaveFileFormat[] = []
	private currentIndex = -1

	private constructor() {}

	public addState() {
		// get json object
		let components = []
		for (const component of MainController.instance.circuitComponents) {
			let componentObject = component.toJson()
			componentObject.selected = component.isSelected
			components.push(componentObject)
		}

		let currentState: SaveFileFormat = {
			version: currentSaveVersion,
			tikzSettings: EnvironmentVariableController.instance.toJson(),
			components: components,
		}

		let shouldAddState = true
		if (this.states.length > 0) {
			let compareState = this.states.at(this.currentIndex)
			if (JSON.stringify(compareState) == JSON.stringify(currentState)) {
				// This and the last state are identical -> no new state
				// sometimes needed for more complicated scenarios
				shouldAddState = false
			}
		}

		// push state on stack
		if (shouldAddState) {
			this.states = this.states.slice(0, this.currentIndex + 1)
			this.states.push(currentState)
			this.currentIndex = this.states.length - 1
		}
	}

	public getCurrentState() {
		return this.states[this.currentIndex]
	}

	public undo() {
		this.currentIndex -= 1
		if (this.currentIndex < 0) {
			this.currentIndex = 0
			return
		}
		this.loadState()
	}

	public redo() {
		this.currentIndex += 1
		if (this.currentIndex >= this.states.length) {
			this.currentIndex = this.states.length - 1
			return
		}
		this.loadState()
	}

	private loadState() {
		// remove all components
		while (MainController.instance.circuitComponents.length > 0) {
			MainController.instance.removeComponent(MainController.instance.circuitComponents[0])
		}

		// load state
		let state = this.states[this.currentIndex].components

		EnvironmentVariableController.instance.fromJson(this.states[this.currentIndex].tikzSettings)
		let components = []

		for (const component of state) {
			let initalializedComponenent = SaveController.fromJson(component)
			if (component.selected && initalializedComponenent) {
				components.push(initalializedComponenent)
			}
		}

		if (components.length > 0) {
			SelectionController.instance.selectComponents(components, SelectionMode.RESET)
		}
	}
}
