import { ButtonGridProperty, Undo } from "../internal"

/**
 * Target for the rotate/flip grid. Either a single component (rotate/flip on the
 * component itself) or the selection controller (rotate/flip the whole selection).
 */
export interface RotateFlipTarget {
	rotate(angleDeg: number): void
	flip(horizontal: boolean): void
}

/**
 * Build the standard six-button rotate/flip grid (90/45 cw, 90/45 ccw, flip-x, flip-y).
 *
 * Used by both the single-component properties pane (via `circuitComponent.addPositioning`)
 * and the multi-edit properties pane (`propertiesController.setMultiForm`). Centralising
 * the labels, callbacks, and tooltips means adding a new operation (e.g. "rotate 30°") is a
 * single-place edit.
 *
 * @param target the rotate/flip recipient (a `CircuitComponent` or the `SelectionController`)
 * @param tooltips the six tooltip strings, in label order. Different call sites use slightly
 *                 different copy ("the component" vs "the components"), so the helper takes
 *                 them as a parameter rather than baking strings in.
 */
export function buildRotateFlipGrid(target: RotateFlipTarget, tooltips: [string, string, string, string, string, string]): ButtonGridProperty {
	return new ButtonGridProperty(
		2,
		[
			["Rotate 90° CW", "rotate_right"],
			["Rotate 90° CCW", "rotate_left"],
			["Rotate 45° CW", "rotate_right"],
			["Rotate 45° CCW", "rotate_left"],
			["Flip vertically", ["flip", "rotateText"]],
			["Flip horizontally", "flip"],
		],
		[
			() => {
				target.rotate(-90)
				Undo.instance.addState()
			},
			() => {
				target.rotate(90)
				Undo.instance.addState()
			},
			() => {
				target.rotate(-45)
				Undo.instance.addState()
			},
			() => {
				target.rotate(45)
				Undo.instance.addState()
			},
			() => {
				target.flip(true)
				Undo.instance.addState()
			},
			() => {
				target.flip(false)
				Undo.instance.addState()
			},
		],
		false,
		tooltips
	)
}
