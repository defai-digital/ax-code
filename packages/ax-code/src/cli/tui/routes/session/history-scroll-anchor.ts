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

type ScrollTarget = {
  scrollTop: number
  scrollHeight: number
  scrollTo: (top: number) => void
}

const EARLIER_ANCHOR_ATTEMPTS = 8
const EARLIER_ANCHOR_DELAY_MS = 25

/**
 * Poll until prepended rows change scrollHeight, then keep the anchored row in view.
 * Returns a cancel function for the pending poll.
 */
export function restoreScrollAfterPrepend(input: {
  scroll: ScrollTarget
  anchor: ScrollAnchor
  isCurrent: () => boolean
  schedule: (fn: () => void, delayMs: number) => () => void
  attempts?: number
  delayMs?: number
}) {
  const attempts = input.attempts ?? EARLIER_ANCHOR_ATTEMPTS
  const delayMs = input.delayMs ?? EARLIER_ANCHOR_DELAY_MS
  let used = 0
  let cancelScheduled: (() => void) | undefined
  const restore = () => {
    cancelScheduled = undefined
    if (!input.isCurrent()) return
    // The user scrolled while the page was loading: keep their position.
    if (input.scroll.scrollTop !== input.anchor.top) return
    if (input.scroll.scrollHeight === input.anchor.height && ++used < attempts) {
      cancelScheduled = input.schedule(restore, delayMs)
      return
    }
    const top = restoredScrollTop(input.anchor, input.scroll.scrollHeight)
    if (top !== undefined) input.scroll.scrollTo(top)
  }
  cancelScheduled = input.schedule(restore, delayMs)
  return () => {
    cancelScheduled?.()
    cancelScheduled = undefined
  }
}
