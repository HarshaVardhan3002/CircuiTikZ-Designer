import { CanvasController } from "./internal"

/**
 * Rasterize the current SVG canvas to a PNG data URL so a vision-capable model can actually SEE the
 * rendered circuit (overlaps, disconnections, layout) instead of only reading its structure.
 *
 * Best-effort: returns null if capture is not possible (no canvas, or a tainted/failed raster). The
 * longest side is capped at `maxDim` px to keep the payload small. Renders on an opaque white
 * background so the model sees a normal-looking diagram rather than transparency.
 */
export async function captureCanvasPng(maxDim = 1024): Promise<string | null> {
	try {
		const svg = CanvasController.instance?.canvas?.node as SVGSVGElement | undefined
		if (!svg) return null

		const vb = svg.viewBox?.baseVal
		const w = (vb && vb.width) || svg.clientWidth || 800
		const h = (vb && vb.height) || svg.clientHeight || 600
		if (!w || !h) return null

		const scale = Math.min(1, maxDim / Math.max(w, h))
		const cw = Math.max(1, Math.round(w * scale))
		const ch = Math.max(1, Math.round(h * scale))

		const clone = svg.cloneNode(true) as SVGSVGElement
		clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
		clone.setAttribute("width", String(cw))
		clone.setAttribute("height", String(ch))
		// Keep the original view mapped into the capped raster size.
		clone.setAttribute("viewBox", (vb ? vb.x : 0) + " " + (vb ? vb.y : 0) + " " + w + " " + h)
		// Opaque white background rect behind everything.
		const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect")
		bg.setAttribute("x", String(vb ? vb.x : 0))
		bg.setAttribute("y", String(vb ? vb.y : 0))
		bg.setAttribute("width", String(w))
		bg.setAttribute("height", String(h))
		bg.setAttribute("fill", "#ffffff")
		clone.insertBefore(bg, clone.firstChild)

		const xml = new XMLSerializer().serializeToString(clone)
		const url = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml)))

		const img = new Image()
		img.decoding = "sync"
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve()
			img.onerror = () => reject(new Error("SVG image load failed"))
			img.src = url
		})

		const c = document.createElement("canvas")
		c.width = cw
		c.height = ch
		const ctx = c.getContext("2d")
		if (!ctx) return null
		ctx.fillStyle = "#ffffff"
		ctx.fillRect(0, 0, cw, ch)
		ctx.drawImage(img, 0, 0, cw, ch)

		return c.toDataURL("image/png")
	} catch {
		return null
	}
}
