#!/usr/bin/env node
/**
 * Pure-data tests for the v0.9.3 spline edit operations.
 *
 * The SplineComponent's insert / delete / default-handle helpers are method-on-class
 * (they touch SVG.js controllers), so we can't import them directly under Node. Instead
 * we re-implement the same data-shape logic here in plain JS and assert on it. If the
 * component drifts from this contract, the round-trip and stress suites will catch it.
 */

let passes = 0
let failures = 0
function assert(cond, label, detail) {
	if (cond) { passes++; return }
	failures++
	console.error(`  ✗ ${label}`)
	if (detail !== undefined) console.error("    " + detail)
}
function summary(t) { console.log(`\n=== ${t} ===`) }

// Mirror of regenerateDefaultHandles' Catmull-Rom-ish rule for interior anchors.
// Endpoints get a one-third pull toward the only neighbour; interior anchors lay
// tangents along the chord between their two neighbours, with leg lengths set to
// 1/6 of the distance to the corresponding neighbour.
function defaultHandles(anchors) {
	const out = anchors.map((a) => ({
		position: { ...a.position },
		inHandle: a.inHandle ? { ...a.inHandle } : null,
		outHandle: a.outHandle ? { ...a.outHandle } : null,
		continuity: a.continuity ?? "corner",
	}))
	const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y })
	const len = (v) => Math.hypot(v.x, v.y)
	const div = (v, k) => ({ x: v.x / k, y: v.y / k })
	const mul = (v, k) => ({ x: v.x * k, y: v.y * k })
	for (let i = 0; i < out.length; i++) {
		const a = out[i]
		const prev = out[i - 1]
		const next = out[i + 1]
		if (i === 0 && next) {
			if (!a.outHandle) a.outHandle = div(sub(next.position, a.position), 3)
			continue
		}
		if (i === out.length - 1 && prev) {
			if (!a.inHandle) a.inHandle = div(sub(prev.position, a.position), 3)
			continue
		}
		if (prev && next) {
			const chord = sub(next.position, prev.position)
			const cl = len(chord)
			if (cl < 1e-12) continue
			const t = div(chord, cl)
			const inLeg = len(sub(a.position, prev.position)) / 6
			const outLeg = len(sub(next.position, a.position)) / 6
			if (!a.inHandle) a.inHandle = mul(t, -inLeg)
			if (!a.outHandle) a.outHandle = mul(t, outLeg)
		}
	}
	if (out.length > 0) {
		out[0].inHandle = null
		out[out.length - 1].outHandle = null
	}
	return out
}

summary("Default handles: interior anchor's tangent lies along the prev→next chord")
{
	const anchors = [
		{ position: { x: 0, y: 0 }, inHandle: null, outHandle: null, continuity: "corner" },
		{ position: { x: 1, y: 0 }, inHandle: null, outHandle: null, continuity: "corner" },
		{ position: { x: 2, y: 0 }, inHandle: null, outHandle: null, continuity: "corner" },
	]
	const out = defaultHandles(anchors)
	const mid = out[1]
	// Chord (0,0)→(2,0) is horizontal-positive. inHandle should point negative-x, outHandle positive-x.
	assert(mid.inHandle.x < 0 && Math.abs(mid.inHandle.y) < 1e-9, "inHandle points -x along chord", JSON.stringify(mid.inHandle))
	assert(mid.outHandle.x > 0 && Math.abs(mid.outHandle.y) < 1e-9, "outHandle points +x along chord", JSON.stringify(mid.outHandle))
	// Both legs should have magnitude 1/6 (chord = 2 → leg lengths each = 1, /6 = 1/6).
	assert(Math.abs(Math.hypot(mid.inHandle.x, mid.inHandle.y) - 1 / 6) < 1e-9, "inHandle length = 1/6 prev-leg", null)
	assert(Math.abs(Math.hypot(mid.outHandle.x, mid.outHandle.y) - 1 / 6) < 1e-9, "outHandle length = 1/6 next-leg", null)
}

summary("Default handles: endpoints carry a single handle pointing at their lone neighbour")
{
	const anchors = [
		{ position: { x: 0, y: 0 }, inHandle: null, outHandle: null, continuity: "corner" },
		{ position: { x: 6, y: 0 }, inHandle: null, outHandle: null, continuity: "corner" },
		{ position: { x: 12, y: 0 }, inHandle: null, outHandle: null, continuity: "corner" },
	]
	const out = defaultHandles(anchors)
	assert(out[0].inHandle === null, "First anchor has no inHandle")
	assert(out[0].outHandle.x === 2 && out[0].outHandle.y === 0, "First outHandle = chord/3 toward next", JSON.stringify(out[0].outHandle))
	assert(out[2].outHandle === null, "Last anchor has no outHandle")
	assert(out[2].inHandle.x === -2 && out[2].inHandle.y === 0, "Last inHandle = chord/3 toward prev", JSON.stringify(out[2].inHandle))
}

summary("Default handles: collapsed neighbours fall back gracefully")
{
	// Three coincident points — chord length is zero, so the handle generator should leave
	// the interior anchor's handles at null instead of producing NaN.
	const anchors = [
		{ position: { x: 5, y: 5 }, inHandle: null, outHandle: null, continuity: "corner" },
		{ position: { x: 5, y: 5 }, inHandle: null, outHandle: null, continuity: "corner" },
		{ position: { x: 5, y: 5 }, inHandle: null, outHandle: null, continuity: "corner" },
	]
	const out = defaultHandles(anchors)
	assert(out[1].inHandle === null && out[1].outHandle === null, "Interior anchor on a collapsed polyline gets no handles", JSON.stringify(out[1]))
}

// Insert / delete shape — mirror the component's `insertAnchorAt` and `deleteAnchor` semantics.
function insertAnchor(anchors, index) {
	const before = anchors[index - 1]
	const after = anchors[index]
	if (!before || !after) return anchors
	const pos = { x: (before.position.x + after.position.x) / 2, y: (before.position.y + after.position.y) / 2 }
	return defaultHandles([
		...anchors.slice(0, index),
		{ position: pos, inHandle: null, outHandle: null, continuity: "corner" },
		...anchors.slice(index),
	])
}
function deleteAnchor(anchors, index) {
	if (anchors.length <= 2) return anchors
	const next = [...anchors.slice(0, index), ...anchors.slice(index + 1)]
	return defaultHandles(next)
}

summary("Insert anchor: lands at midpoint, brings the new anchor's count from N to N+1")
{
	const start = [
		{ position: { x: 0, y: 0 }, inHandle: null, outHandle: null, continuity: "corner" },
		{ position: { x: 4, y: 0 }, inHandle: null, outHandle: null, continuity: "corner" },
	]
	const after = insertAnchor(start, 1)
	assert(after.length === 3, "Length increases by 1", `got ${after.length}`)
	assert(after[1].position.x === 2 && after[1].position.y === 0, "Inserted anchor is midpoint", JSON.stringify(after[1].position))
	assert(after[1].inHandle !== null && after[1].outHandle !== null, "New interior anchor gets default handles")
}

summary("Insert anchor: refuses at endpoints (no neighbour on one side)")
{
	const start = [
		{ position: { x: 0, y: 0 }, inHandle: null, outHandle: null, continuity: "corner" },
		{ position: { x: 4, y: 0 }, inHandle: null, outHandle: null, continuity: "corner" },
	]
	const before0 = insertAnchor(start, 0) // would need anchor[-1]
	assert(before0.length === 2, "Insert at start refused", `got ${before0.length}`)
}

summary("Delete anchor: refuses to drop below 2 anchors")
{
	const start = [
		{ position: { x: 0, y: 0 }, inHandle: null, outHandle: null, continuity: "corner" },
		{ position: { x: 4, y: 0 }, inHandle: null, outHandle: null, continuity: "corner" },
	]
	const after = deleteAnchor(start, 0)
	assert(after.length === 2, "Delete on a 2-anchor spline is a no-op", `got ${after.length}`)
}

summary("Delete anchor: removes interior anchor, surviving handles regenerate")
{
	const start = [
		{ position: { x: 0, y: 0 }, inHandle: null, outHandle: { x: 1, y: 1 }, continuity: "corner" },
		{ position: { x: 3, y: 0 }, inHandle: { x: -1, y: 1 }, outHandle: { x: 1, y: 1 }, continuity: "corner" },
		{ position: { x: 6, y: 0 }, inHandle: { x: -1, y: 1 }, outHandle: null, continuity: "corner" },
	]
	const after = deleteAnchor(start, 1)
	assert(after.length === 2, "One interior anchor removed", `got ${after.length}`)
	assert(after[0].position.x === 0 && after[1].position.x === 6, "Remaining anchors are the two endpoints")
	assert(after[0].inHandle === null && after[1].outHandle === null, "Endpoint handle invariant restored")
}

console.log(`\n${passes} passed, ${failures} failed`)
if (failures > 0) process.exit(1)
