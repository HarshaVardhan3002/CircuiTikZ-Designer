// src/scripts/vision/controllers/confidenceOverlayController.ts
import * as SVG from "@svgdotjs/svg.js"
import { CanvasController, type CircuitComponent } from "../../internal"
import { classifyConfidence } from "../pipeline/confidenceClassifier"

interface OverlayHandle {
	component: CircuitComponent
	halo: SVG.Element
	badgeBg: SVG.Element
	badgeText: SVG.Element
}

export class ConfidenceOverlayController {
	private static _instance: ConfidenceOverlayController
	public static get instance(): ConfidenceOverlayController {
		return (this._instance ??= new ConfidenceOverlayController())
	}

	private overlayLayer: SVG.G | null = null
	private items: OverlayHandle[] = []

	private ensureLayer(): SVG.G {
		if (this.overlayLayer) return this.overlayLayer
		const canvas = CanvasController.instance.canvas as unknown as SVG.Svg
		this.overlayLayer = canvas.group().addClass("vision-overlay-layer")
		return this.overlayLayer
	}

	/**
	 * Decorate the supplied components with halos/badges where confidence is low.
	 * Existing decorations are cleared first; pass an empty array to clear all.
	 */
	public applyConfidence(components: CircuitComponent[]): void {
		this.clear()
		const layer = this.ensureLayer()

		for (const c of components) {
			const conf = c.detectionConfidence
			if (conf === undefined) continue
			if (classifyConfidence(conf) !== "low") continue

			// Wires have a "bbox" but it's the path-line rectangle, which makes a misleading halo.
			// V1 only flags symbol components; a wire-specific affordance (e.g. coloured stroke) is
			// V1.1 work. Detect via the runtime class name so we don't add a hard import dep on
			// WireComponent - keeps this controller decoupled.
			if ((c as { constructor: { name: string } }).constructor.name === "WireComponent") continue

			const bbox = c.visualization?.bbox?.()
			if (!bbox) continue

			const padding = 4
			const halo = layer
				.rect(bbox.width + padding * 2, bbox.height + padding * 2)
				.move(bbox.x - padding, bbox.y - padding)
				.addClass("vision-halo")

			const badgeR = 9
			const cx = bbox.x + bbox.width + padding
			const cy = bbox.y - padding
			const badgeBg = layer.circle(badgeR * 2).center(cx, cy).addClass("vision-badge-bg")
			const badgeText = layer
				.text("?")
				.center(cx, cy)
				.addClass("vision-badge")

			// Make the badge clickable for the inline type-picker popover (T25).
			const badgeNode = (badgeBg.node as unknown) as SVGGraphicsElement
			badgeNode.style.pointerEvents = "all"
			badgeNode.style.cursor = "pointer"
			badgeNode.addEventListener("pointerdown", (ev) => {
				ev.stopPropagation()
				this.openTypePicker(c, ev as PointerEvent)
			})

			this.items.push({ component: c, halo, badgeBg, badgeText })
		}
	}

	public clear(): void {
		for (const item of this.items) {
			item.halo.remove()
			item.badgeBg.remove()
			item.badgeText.remove()
		}
		this.items = []
	}

	/** Bounding box, in canvas units, of the next flagged component (or null if none). */
	public nextFlag(after?: CircuitComponent): CircuitComponent | null {
		if (this.items.length === 0) return null
		if (!after) return this.items[0].component
		const idx = this.items.findIndex((i) => i.component === after)
		if (idx === -1) return this.items[0].component
		return this.items[(idx + 1) % this.items.length].component
	}

	public flaggedCount(): number {
		return this.items.length
	}

	private openTypePicker(component: CircuitComponent, ev: PointerEvent): void {
		const popover = document.createElement("div")
		popover.className = "vision-type-popover card shadow"
		popover.style.position = "fixed"
		popover.style.left = `${ev.clientX}px`
		popover.style.top = `${ev.clientY}px`
		popover.style.zIndex = "10000"
		popover.style.minWidth = "180px"

		const header = document.createElement("div")
		header.className = "card-header py-1 px-2 small"
		header.textContent = `Component type - ${component.detectionId ?? "(unknown id)"}`
		popover.appendChild(header)

		const list = document.createElement("div")
		list.className = "list-group list-group-flush"
		popover.appendChild(list)

		const alternates = component.detectionAlternates ?? []
		const seen = new Set<string>()
		for (const alt of alternates) {
			if (seen.has(alt.type)) continue
			seen.add(alt.type)
			const item = document.createElement("button")
			item.type = "button"
			item.className = "list-group-item list-group-item-action py-1 px-2 small"
			item.textContent = `${alt.type} - ${(alt.confidence * 100).toFixed(0)}%`
			item.addEventListener("click", () => {
				this.replaceComponentType(component, alt.type)
				popover.remove()
			})
			list.appendChild(item)
		}

		const other = document.createElement("button")
		other.type = "button"
		other.className = "list-group-item list-group-item-action py-1 px-2 small fst-italic"
		other.textContent = "Other…"
		other.addEventListener("click", () => {
			popover.remove()
			document.dispatchEvent(new CustomEvent("vision:request-type-change", { detail: { component } }))
		})
		list.appendChild(other)

		document.body.appendChild(popover)
		const close = (e: Event) => {
			if (popover.contains(e.target as Node)) return
			popover.remove()
			document.removeEventListener("pointerdown", close, true)
		}
		// Defer one tick so the current pointer-down doesn't immediately close us.
		setTimeout(() => document.addEventListener("pointerdown", close, true), 0)
	}

	private replaceComponentType(c: CircuitComponent, newType: string): void {
		// V1: emit an event the host application can pick up. Fully integrating with the
		// existing component-replacement controller is out of scope of this task - fire an
		// event and let the host bind to it.
		document.dispatchEvent(new CustomEvent("vision:replace-component-type", {
			detail: { component: c, newType },
		}))
	}
}
