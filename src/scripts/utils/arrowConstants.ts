import * as SVG from "@svgdotjs/svg.js"
import { approxCompare } from "./utils"

/** Width of the stroke used for the arrow shafts (svg user units). */
export const arrowStrokeWidth = 0.5

/** Reference length, in centimetres, that CircuiTikZ's `Rlen` macro defaults to. */
export const defaultRlen = 1.4

/** Master scale factor for current arrow tips. */
export const currentArrowScale = 16

/** 96px per inch / 2.54 cm per inch — px-per-cm conversion factor. */
export const cmtopx = 4800 / 127

/** Sin of 4 degrees — used as the threshold for the label-anchor direction calculation. */
const sin4 = 0.06976

export type ArrowFrame = {
	/** Angle (radians) of the shaft direction from start to end. */
	angle: number
	/** End point rotated about start so the shaft is horizontal. */
	endTrans: SVG.Point
	/** Midpoint of the rotated shaft (start..endTrans). */
	midTrans: SVG.Point
	/** Direction the label's anchor should point in (snapped to {-1, 0, 1} on each axis). */
	labelAnchor: SVG.Point
}

/**
 * Compute the shared geometry frame used by both voltage and current arrow renderers.
 *
 * Both call sites need the same angle, the same rotated end point, the same midpoint,
 * and the same label-anchor direction. Different arrow types then transform the label
 * anchor differently (e.g. voltage flips it based on `above`, current flips on `labelBelow`),
 * so this helper only computes the raw frame; the caller multiplies in their sign.
 */
export function computeArrowFrame(start: SVG.Point, end: SVG.Point): ArrowFrame {
	const diff = end.sub(start)
	const angle = Math.atan2(diff.y, diff.x)
	const endTrans = end.rotate(angle, start, true)
	const midTrans = start.add(endTrans).div(2)
	const labelAnchor = new SVG.Point(approxCompare(Math.sin(angle), 0, sin4), -approxCompare(Math.cos(angle), 0, sin4))
	return { angle, endTrans, midTrans, labelAnchor }
}
