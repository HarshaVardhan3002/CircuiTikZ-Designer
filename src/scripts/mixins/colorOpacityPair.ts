import * as SVG from "@svgdotjs/svg.js"
import { ColorProperty, SliderProperty } from "../internal"

export type ColorOpacityPair = {
	color: ColorProperty
	opacity: SliderProperty
}

/**
 * Build a coupled (color, opacity) pair for use inside a Strokable / Fillable / future-mixin
 * properties section. The two controls are independent from a UI perspective, but the colour
 * picker resets the opacity slider when the user clears the colour (so a "no colour" state
 * implies "full opacity, no colour" rather than "transparent").
 *
 * The change-listener wiring for both properties (calling `updateTheme()` and `update()` on
 * the host) is deliberately left to the caller - the helper builds the controls and the
 * coupling, but the host owns the side-effects.
 *
 * @param label human-readable name for the colour control (e.g. "Color")
 * @param tooltip optional tooltip for both controls (currently passed through to the
 *                colour picker only - opacity slider is self-explanatory)
 * @param idPrefix the property-ID stem (e.g. "fill" → ids "fill:color" and "fill:opacity")
 */
export function buildColorOpacityPair(label: string, tooltip: string | undefined, idPrefix: string): ColorOpacityPair {
	const opacity = new SliderProperty(
		"Opacity",
		0,
		100,
		1,
		new SVG.Number(100, "%"),
		undefined,
		undefined,
		idPrefix + ":opacity"
	)
	const color = new ColorProperty(label, null, undefined, tooltip, idPrefix + ":color")
	return { color, opacity }
}
