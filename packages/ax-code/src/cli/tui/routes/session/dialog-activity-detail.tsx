import { onCleanup, onMount, createMemo, createSignal, For, Show } from "solid-js"
import { TextAttributes, type ScrollBoxRenderable } from "ax-tui"
import { useKeyboard } from "ax-tui/solid"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { Clipboard } from "@tui/util/clipboard"
import { detailFor, type Entry } from "./activity-browser"

/**
 * Full record of one activity entry: what, when, why and the result, with secrets
 * redacted and very long output cut (the copy action keeps the whole redacted text).
 * Esc returns to the list instead of closing the dialog, so a review can move from
 * entry to entry without losing its place.
 */
export function DialogActivityDetail(props: {
  /** Every entry, used to infer related safety decisions. */
  entries: Entry[]
  /** The entries currently listed, in list order; n/p walk this. */
  visible: Entry[]
  index: number
  onBack: () => void
  onJump?: (messageID: string) => void
}) {
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()
  const [index, setIndex] = createSignal(props.index)
  const entry = createMemo(() => props.visible[index()])
  const detail = createMemo(() => {
    const current = entry()
    return current ? detailFor(current, props.entries) : undefined
  })
  let scroll: ScrollBoxRenderable | undefined

  onMount(() => {
    dialog.setSize("large")
  })
  onCleanup(
    dialog.registerEscapeHandler(() => {
      props.onBack()
      return true
    }),
  )

  const step = (direction: 1 | -1) => {
    const next = index() + direction
    if (next < 0 || next >= props.visible.length) return
    setIndex(next)
    scroll?.scrollTo(0)
  }

  const copy = () => {
    const text = detail()?.copyText
    if (!text) return
    void Clipboard.copy(text)
      .then(() => toast.show({ message: "Copied the redacted record", variant: "success", duration: 1500 }))
      .catch((error) =>
        toast.show({ message: error instanceof Error ? error.message : "Failed to copy", variant: "error" }),
      )
  }

  useKeyboard((evt) => {
    if (evt.ctrl || evt.meta || evt.super) return
    if (evt.name === "backspace" || evt.name === "left" || evt.name === "h") {
      evt.preventDefault()
      props.onBack()
    } else if (evt.name === "n" || evt.name === "right") {
      evt.preventDefault()
      step(1)
    } else if (evt.name === "p") {
      evt.preventDefault()
      step(-1)
    } else if (evt.name === "y") {
      evt.preventDefault()
      copy()
    } else if (evt.name === "g") {
      const id = detail()?.messageID
      if (!id || !props.onJump) return
      evt.preventDefault()
      props.onJump(id)
      dialog.clear()
    } else if (evt.name === "down" || evt.name === "j") scroll?.scrollBy(1)
    else if (evt.name === "up" || evt.name === "k") scroll?.scrollBy(-1)
    else if (evt.name === "pagedown" || evt.name === "space") scroll?.scrollBy(Math.max(1, (scroll?.height ?? 10) - 1))
    else if (evt.name === "pageup") scroll?.scrollBy(-Math.max(1, (scroll?.height ?? 10) - 1))
  })

  const hints = createMemo(() =>
    [
      "esc back",
      `n/p next/prev (${index() + 1}/${props.visible.length})`,
      "y copy",
      detail()?.messageID && props.onJump ? "g go to message" : "",
    ]
      .filter(Boolean)
      .join("  ·  "),
  )

  return (
    <box paddingLeft={4} paddingRight={4} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {detail()?.title ?? "Activity"}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => props.onBack()}>
          esc
        </text>
      </box>
      <text fg={theme.textMuted}>{hints()}</text>
      <Show when={detail()} fallback={<text fg={theme.textMuted}>This entry is no longer available.</text>}>
        {(current) => (
          <scrollbox ref={(r: ScrollBoxRenderable) => (scroll = r)} maxHeight={20} gap={1}>
            <For each={current().sections}>
              {(section) => (
                <box>
                  <text fg={theme.primary} attributes={TextAttributes.BOLD}>
                    {section.heading}
                  </text>
                  <For each={section.lines}>{(line) => <text fg={theme.text}>{line}</text>}</For>
                </box>
              )}
            </For>
          </scrollbox>
        )}
      </Show>
    </box>
  )
}
