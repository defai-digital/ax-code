/** Camera math for the evidence map. The wheel curve matches d3-zoom v3. */

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8

export type Camera = { zoom: number; offsetX: number; offsetY: number }

/**
 * d3-zoom wheelDelta: pixel mode uses 0.002, line mode 0.05, page mode 1.
 * macOS pinch arrives as ctrl+wheel with a tiny delta, so ctrl multiplies by 10.
 * The returned value is the scale factor applied about the pointer (2^delta).
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1
  const mode = deltaMode === 1 ? 0.05 : deltaMode ? 1 : 0.002
  const delta = -deltaY * mode * (ctrlKey ? 10 : 1)
  return 2 ** delta
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

/**
 * Frame `bounds` in a view whose aspect matches the canvas.
 * Small graphs zoom in (up to the scale extent) instead of sitting in a sea of empty world.
 */
export function fitCamera(bounds: Bounds, aspect: number, worldWidth: number): Camera {
  const contentW = Math.max(bounds.maxX - bounds.minX, 1)
  const contentH = Math.max(bounds.maxY - bounds.minY, 1)
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1.5
  const safeWorld = Number.isFinite(worldWidth) && worldWidth > 0 ? worldWidth : 900
  // 8% margin so bubbles are not cut by the frame.
  const viewW = Math.max(contentW, contentH * safeAspect) * 1.08
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, safeWorld / viewW))
  const shownW = safeWorld / zoom
  const shownH = shownW / safeAspect
  return {
    zoom,
    offsetX: (bounds.minX + bounds.maxX) / 2 - shownW / 2,
    offsetY: (bounds.minY + bounds.maxY) / 2 - shownH / 2,
  }
}

/** Scale about a world-space anchor so that anchor stays fixed. Clamped to the scale extent. */
export function zoomAbout(camera: Camera, factor: number, anchor: { x: number; y: number }): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return { ...camera }
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor))
  if (next === camera.zoom) return { zoom: camera.zoom, offsetX: camera.offsetX, offsetY: camera.offsetY }
  const ratio = camera.zoom / next
  return {
    zoom: next,
    offsetX: anchor.x - (anchor.x - camera.offsetX) * ratio,
    offsetY: anchor.y - (anchor.y - camera.offsetY) * ratio,
  }
}
