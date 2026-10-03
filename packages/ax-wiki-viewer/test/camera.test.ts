import { expect, test } from "vitest"
import { MAX_ZOOM, MIN_ZOOM, fitCamera, wheelZoomFactor, zoomAbout } from "../src/camera.js"

test("wheel zoom matches the d3-zoom curve", () => {
  // One notch up (deltaY -120) zooms in. One notch down zooms out by the inverse.
  const zoomIn = wheelZoomFactor(-120, 0, false)
  const zoomOut = wheelZoomFactor(120, 0, false)
  expect(zoomIn).toBeGreaterThan(1)
  expect(zoomOut).toBeLessThan(1)
  expect(zoomIn * zoomOut).toBeCloseTo(1, 10)
  // Pinch (ctrl+wheel) is the same curve with a 10x delta.
  expect(wheelZoomFactor(-12, 0, true)).toBeCloseTo(wheelZoomFactor(-120, 0, false), 10)
  expect(wheelZoomFactor(0, 0, false)).toBe(1)
  expect(wheelZoomFactor(Number.NaN, 0, false)).toBe(1)
  // Line mode (deltaMode 1) is coarser than pixel mode.
  expect(wheelZoomFactor(-1, 1, false)).toBeGreaterThan(wheelZoomFactor(-1, 0, false))
})

test("fitCamera zooms a small cluster up to fill the canvas aspect", () => {
  const fitted = fitCamera({ minX: 400, minY: 250, maxX: 500, maxY: 350 }, 1.5, 900)
  // 100×100 content in a 3:2 frame, plus margin, is much tighter than the 900-wide world.
  expect(fitted.zoom).toBeGreaterThan(1)
  expect(fitted.zoom).toBeLessThanOrEqual(MAX_ZOOM)
  const shownW = 900 / fitted.zoom
  const shownH = shownW / 1.5
  const cx = 450
  const cy = 300
  expect(fitted.offsetX).toBeCloseTo(cx - shownW / 2, 8)
  expect(fitted.offsetY).toBeCloseTo(cy - shownH / 2, 8)
  // The whole padded cluster stays inside the frame.
  expect(fitted.offsetX).toBeLessThanOrEqual(400)
  expect(fitted.offsetY).toBeLessThanOrEqual(250)
  expect(fitted.offsetX + shownW).toBeGreaterThanOrEqual(500)
  expect(fitted.offsetY + shownH).toBeGreaterThanOrEqual(350)

  const wide = fitCamera({ minX: 0, minY: 0, maxX: 40000, maxY: 100 }, 2, 900)
  expect(wide.zoom).toBe(MIN_ZOOM)
})

test("zoomAbout keeps the anchor fixed and clamps the scale extent", () => {
  const start = { zoom: 1, offsetX: 0, offsetY: 0 }
  const zoomed = zoomAbout(start, 2, { x: 100, y: 40 })
  expect(zoomed.zoom).toBe(2)
  // World point 100 was at 100 - offset. After the zoom it stays at the same view fraction.
  const before = (100 - start.offsetX) * start.zoom
  const after = (100 - zoomed.offsetX) * zoomed.zoom
  expect(after).toBeCloseTo(before, 8)
  expect((40 - zoomed.offsetY) * zoomed.zoom).toBeCloseTo(40, 8)

  const capped = zoomAbout({ zoom: MAX_ZOOM, offsetX: 10, offsetY: 10 }, 4, { x: 0, y: 0 })
  expect(capped).toEqual({ zoom: MAX_ZOOM, offsetX: 10, offsetY: 10 })
  const floor = zoomAbout({ zoom: MIN_ZOOM, offsetX: 3, offsetY: 4 }, 0.1, { x: 1, y: 1 })
  expect(floor.zoom).toBe(MIN_ZOOM)
  expect(zoomAbout(start, 0, { x: 0, y: 0 })).toEqual(start)
  expect(zoomAbout(start, Number.NaN, { x: 0, y: 0 })).toEqual(start)
})
