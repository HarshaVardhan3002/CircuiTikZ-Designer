import { Point } from "@svgdotjs/svg.js"
import {
	ComponentSaveObject,
	MainController,
	SaveController,
	SelectionController,
	SelectionMode,
	Undo,
} from "../internal"

type Clipboard = {
	components: ComponentSaveObject[]
	selectionPos: Point
}

/**
 * Class handling copy, paste and cut
 * @class
 */
export class CopyPaste {
	private static _instance: CopyPaste
	public static get instance(): CopyPaste {
		if (!CopyPaste._instance) {
			CopyPaste._instance = new CopyPaste()
		}
		return CopyPaste._instance
	}

	private clipboard: Clipboard | null = null

	private constructor() {}

	public copy() {
		if (SelectionController.instance.hasSelection()) {
			let components: ComponentSaveObject[] = []
			for (const component of SelectionController.instance.currentlySelectedComponents) {
				let componentObject = component.toJson()
				if ("name" in componentObject) {
					componentObject.name = ""
				}

				components.push(componentObject)
			}

			let bbox = SelectionController.instance.getOverallBoundingBox()

			this.clipboard = {
				components: components,
				selectionPos: new Point(bbox.cx, bbox.cy),
			}

			MainController.instance.sendBroadcastMessage("clipboard", this.clipboard)
		}
	}

	public setClipboard(clipboard: Clipboard) {
		this.clipboard = clipboard
	}

	public paste() {
		if (this.clipboard && Object.keys(this.clipboard).length === 0) {
			return
		}

		if (!this.clipboard) {
			return
		}

		SelectionController.instance.deactivateSelection()
		SelectionController.instance.activateSelection()

		let allComponents = []

		for (const component of this.clipboard.components) {
			allComponents.push(SaveController.fromJson(component))
		}

		if (allComponents.length > 0) {
			SelectionController.instance.selectComponents(allComponents, SelectionMode.RESET)
		}
		SelectionController.instance.moveSelectionTo(new Point(this.clipboard.selectionPos).add(new Point(20, 20)))
		Undo.instance.addState()
	}

	public cut() {
		if (SelectionController.instance.hasSelection()) {
			this.copy()

			for (const component of SelectionController.instance.currentlySelectedComponents) {
				MainController.instance.removeComponent(component)
			}
			Undo.instance.addState()
		}
	}
}
