import { createSignal, onCleanup } from "solid-js"
import { streamPaintDecision } from "../routes/session/stream-paint"
import { scheduleTuiTimeout } from "../util/timer"
import { singleLine } from "./block-format"

/** The preview is disposable; the commit queue owns the durable transcript. */
export function createInlinePreview() {
  const [text, setText] = createSignal("")
  let pending = ""
  let lastPaintAt = 0
  let cancel: (() => void) | undefined
  const paint = () => {
    cancel = undefined
    lastPaintAt = Date.now()
    setText(pending)
  }
  onCleanup(() => cancel?.())
  return {
    text,
    update(tail: string, length: number, final: boolean) {
      pending = singleLine(tail)
      cancel?.()
      cancel = undefined
      // Whitespace changes and settled paragraphs often leave the visible
      // preview identical. Do not request a footer paint for those deltas.
      if (pending === text()) return
      const decision = streamPaintDecision({ final, now: Date.now(), lastPaintAt, length })
      if (decision.action === "paint-now") paint()
      else
        cancel = scheduleTuiTimeout(paint, {
          name: "inline.preview-paint",
          delayMs: decision.delayMs,
          unref: true,
        })
    },
  }
}
