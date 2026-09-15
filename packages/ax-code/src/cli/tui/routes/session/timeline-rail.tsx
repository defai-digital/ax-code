import type { ScrollBoxRenderable } from "ax-tui"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { renderableChildren, isRenderableAlive } from "@tui/util/renderable-safety"
import { scheduleTuiInterval } from "@tui/util/timer"
import { timelinePosition, timelineWindow } from "./timeline-rail-model"

/** A two-cell turn navigator; wheel and keyboard scrolling remain on the transcript. */
export function TimelineRail(props: {
  scroll: () => ScrollBoxRenderable | undefined
  turns: readonly { id: string; time: { created: number } }[]
}) {
  const { theme } = useTheme()
  const [height, setHeight] = createSignal(0)
  const [position, setPosition] = createSignal({ active: 0, previous: -1, next: -1 })
  const [hover, setHover] = createSignal<number>()
  function update() {
    const scroll = props.scroll()
    if (!isRenderableAlive(scroll)) return
    setHeight(scroll.viewport.height)
    const children = new Map(
      renderableChildren<{ id: string; y: number }>(scroll, { name: "session-timeline-rail" }).map((child) => [
        child.id,
        child,
      ]),
    )
    const turns = props.turns.map((turn) => children.get(turn.id))
    // Hidden or unrendered messages must not produce invented scroll positions.
    if (turns.some((turn) => !turn)) return
    const next = timelinePosition(turns as { y: number }[], scroll.viewport.y)
    setPosition((previous) =>
      previous.active === next.active && previous.previous === next.previous && previous.next === next.next
        ? previous
        : next,
    )
  }
  onMount(() => {
    update()
    onCleanup(scheduleTuiInterval(update, { name: "session-timeline-rail", delayMs: 200, unref: true }))
  })
  const ticks = createMemo(() => timelineWindow(props.turns.length, height(), position().active))
  function jump(index: number) {
    const turn = props.turns[index]
    const scroll = props.scroll()
    if (!turn || !isRenderableAlive(scroll)) return
    const child = renderableChildren<{ id: string; y: number }>(scroll, { name: "session-timeline-jump" }).find(
      (item) => item.id === turn.id,
    )
    if (child) scroll.scrollBy(child.y - scroll.viewport.y)
    update()
  }
  const time = () => {
    const turn = props.turns[hover() ?? position().active]
    if (!turn || !Number.isFinite(turn.time.created)) return ""
    const date = new Date(turn.time.created)
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
  }
  return (
    <box width={2} flexShrink={0} onMouseOut={() => setHover(undefined)}>
      <Show when={ticks().length}>
        <text
          position="absolute"
          top={0}
          fg={position().previous >= 0 ? theme.textMuted : theme.border}
          selectable={false}
          onMouseUp={() => jump(position().previous)}
        >
          {" "}
          ▴
        </text>
        <For each={ticks()}>
          {(tick) => (
            <text
              position="absolute"
              top={tick.row}
              fg={tick.index === position().active ? theme.primary : hover() === tick.index ? theme.text : theme.border}
              selectable={false}
              onMouseOver={() => setHover(tick.index)}
              onMouseUp={() => jump(tick.index)}
            >
              {tick.index === position().active ? "\u2501\u2501" : " \u2500"}
            </text>
          )}
        </For>
        <text
          position="absolute"
          top={Math.max(0, height() - 1)}
          fg={position().next >= 0 ? theme.textMuted : theme.border}
          selectable={false}
          onMouseUp={() => jump(position().next)}
        >
          {" "}
          ▾
        </text>
        <Show when={hover() !== undefined}>
          <text
            position="absolute"
            right={3}
            top={ticks().find((tick) => tick.index === hover())?.row ?? 0}
            width={5}
            bg={theme.background}
            fg={theme.textMuted}
            selectable={false}
          >
            {time()}
          </text>
        </Show>
      </Show>
    </box>
  )
}
