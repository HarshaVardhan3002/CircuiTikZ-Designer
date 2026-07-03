// src/scripts/vision/controllers/reviewChipController.ts
import { CanvasController, type CircuitComponent } from "../../internal"
import { ConfidenceOverlayController } from "./confidenceOverlayController"

export class ReviewChipController {
	private static _instance: ReviewChipController
	public static get instance(): ReviewChipController {
		return (this._instance ??= new ReviewChipController())
	}

	private chip: HTMLDivElement | null = null
	private label: HTMLSpanElement | null = null
	private prevBtn: HTMLButtonElement | null = null
	private nextBtn: HTMLButtonElement | null = null
	private dismissBtn: HTMLButtonElement | null = null

	private cursor: CircuitComponent | null = null

	private constructor() {}

	/** Bind to the chip's DOM. Called once on app start, after the markup exists. */
	public bind(): void {
		this.chip = document.getElementById("visionReviewChip") as HTMLDivElement | null
		if (!this.chip) return
		this.label = this.chip.querySelector("[data-role=label]") as HTMLSpanElement
		this.prevBtn = this.chip.querySelector("[data-role=prev]") as HTMLButtonElement
		this.nextBtn = this.chip.querySelector("[data-role=next]") as HTMLButtonElement
		this.dismissBtn = this.chip.querySelector("[data-role=dismiss]") as HTMLButtonElement

		this.prevBtn?.addEventListener("click", () => this.step(-1))
		this.nextBtn?.addEventListener("click", () => this.step(+1))
		this.dismissBtn?.addEventListener("click", () => this.dismiss())
		this.update()
	}

	/** Recompute count + visibility. Call after every detection. */
	public update(): void {
		if (!this.chip) return
		const n = ConfidenceOverlayController.instance.flaggedCount()
		if (n === 0) {
			this.chip.style.display = "none"
			return
		}
		this.chip.style.display = "flex"
		if (this.label) {
			this.label.textContent = `⚠ ${n} of ${this.totalReviewable()} need review`
		}
	}

	private totalReviewable(): number {
		// For now, equivalent to flaggedCount (we only count low-confidence). Wired separately so
		// V1.1's medium-confidence inclusion is a one-line change.
		return ConfidenceOverlayController.instance.flaggedCount()
	}

	private step(direction: 1 | -1): void {
		const next = direction === 1
			? ConfidenceOverlayController.instance.nextFlag(this.cursor ?? undefined)
			: this.previousFlag()
		if (!next) return
		this.cursor = next
		this.scrollTo(next)
	}

	private previousFlag(): CircuitComponent | null {
		// Implemented as N-1 next-flag calls so the overlay controller stays the single source of truth.
		const n = ConfidenceOverlayController.instance.flaggedCount()
		if (n === 0) return null
		let cursor = this.cursor
		for (let i = 0; i < n - 1; i++) {
			cursor = ConfidenceOverlayController.instance.nextFlag(cursor ?? undefined) ?? cursor
		}
		return cursor
	}

	private scrollTo(c: CircuitComponent): void {
		const bbox = c.visualization?.bbox?.()
		if (!bbox) return
		// CanvasController may or may not expose panTo — keep optional.
		const cc = CanvasController.instance as unknown as { panTo?: (p: { x: number; y: number }) => void }
		cc.panTo?.({ x: bbox.cx, y: bbox.cy })
	}

	public dismiss(): void {
		ConfidenceOverlayController.instance.clear()
		this.cursor = null
		this.update()
	}
}
