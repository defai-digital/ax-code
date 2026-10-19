type ScrollAnchor = {
  top: number
  height: number
  atBottom: boolean
}

/** Snapshot of a ScrollBoxRenderable: scrollTop, scrollHeight, and viewport.height. */
export function captureScrollAnchor(scroll: {
  scrollTop: number
  scrollHeight: number
  viewport: { height: number }
}): ScrollAnchor {
  const maxTop = Math.max(0, scroll.scrollHeight - scroll.viewport.height)
  return {
    top: scroll.scrollTop,
    height: scroll.scrollHeight,
    atBottom: scroll.scrollTop >= maxTop,
  }
}

/** Keep the same content in view after older messages prepend. Undefined when sticky scroll owns the bottom. */
export function restoredScrollTop(anchor: ScrollAnchor, newHeight: number) {
  if (anchor.atBottom) return
  return anchor.top + (newHeight - anchor.height)
}
