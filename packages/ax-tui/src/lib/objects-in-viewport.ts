import type { ViewportBounds } from "../core/types.js"

interface ViewportObject {
  screenX: number
  screenY: number
  width: number
  height: number
  zIndex: number
}

/**
 * Returns objects that overlap with the viewport bounds.
 *
 * @param viewport - The viewport bounds to check against
 * @param objects - Array of objects MUST be sorted by screen position (screenY for column, screenX for row direction)
 * @param direction - Primary scroll direction: "column" (vertical) or "row" (horizontal)
 * @param padding - Extra padding around viewport to include nearby objects
 * @param minTriggerSize - Minimum array size to use binary search optimization
 * @returns Array of visible objects sorted by zIndex
 *
 * @remarks
 * Objects must be pre-sorted by their start screen position (screenY for column direction, screenX for row direction).
 * Unsorted input will produce incorrect results.
 */
export function getObjectsInViewport<T extends ViewportObject>(
  viewport: ViewportBounds,
  objects: T[],
  direction: "row" | "column" = "column",
  padding: number = 10,
  minTriggerSize: number = 16,
): T[] {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return []
  }

  if (objects.length === 0) {
    return []
  }

  const viewportTop = viewport.y - padding
  const viewportBottom = viewport.y + viewport.height + padding
  const viewportLeft = viewport.x - padding
  const viewportRight = viewport.x + viewport.width + padding

  const isRow = direction === "row"

  const children = objects
  const totalChildren = children.length
  if (totalChildren === 0) return []

  const vpStart = isRow ? viewportLeft : viewportTop
  const vpEnd = isRow ? viewportRight : viewportBottom

  // Starts are sorted, but ends need not be: an early background panel may
  // extend past thousands of shorter siblings. Bound the right edge by start
  // position, then inspect the full prefix so no overlapping object is lost.
  let right = totalChildren
  if (totalChildren >= minTriggerSize) {
    let lo = 0
    let hi = totalChildren
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2)
      const start = isRow ? children[mid].screenX : children[mid].screenY
      if (start < vpEnd) lo = mid + 1
      else hi = mid
    }
    right = lo
  }
  const visibleChildren: T[] = []

  // Collect candidates that also overlap on the cross axis
  for (let i = 0; i < right; i++) {
    const child = children[i]
    const start = isRow ? child.screenX : child.screenY
    const end = isRow ? child.screenX + child.width : child.screenY + child.height

    // Check primary axis overlap (optimization: skip objects that don't overlap)
    if (end <= vpStart) continue
    if (start >= vpEnd) break

    // Check cross-axis overlap
    if (isRow) {
      const childBottom = child.screenY + child.height
      if (childBottom <= viewportTop) continue
      const childTop = child.screenY
      if (childTop >= viewportBottom) continue
    } else {
      const childRight = child.screenX + child.width
      if (childRight <= viewportLeft) continue
      const childLeft = child.screenX
      if (childLeft >= viewportRight) continue
    }

    visibleChildren.push(child)
  }

  // Sort by zIndex
  if (visibleChildren.length > 1) {
    visibleChildren.sort((a, b) => (a.zIndex > b.zIndex ? 1 : a.zIndex < b.zIndex ? -1 : 0))
  }

  return visibleChildren
}
