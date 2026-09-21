import type { ScrollBoxRenderable } from "ax-tui"
import { useTerminalDimensions } from "ax-tui/solid"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { renderableChildren, isRenderableAlive } from "@tui/util/renderable-safety"
import { scheduleTuiInterval } from "@tui/util/timer"
import { RoundedBorder } from "@tui/ui/primitives/card"
import { timelineCard, timelinePosition, timelineWindow } from "./timeline-rail-model"

/** A two-cell turn navigator; wheel and keyboard scrolling remain on the transcript. */
export function TimelineRail(props: {
  scroll: () => ScrollBoxRenderable | undefined
  turns: readonly { id: string; time: { created: number }; preview?: string }[]
}) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const [height, setHeight] = createSignal(0)
  const [position, setPosition] = createSignal({ active: 0, previous: -1, next: -1, atBottom: false })
  const [hover, setHover] = createSignal<number>()
  const [railHovered, setRailHovered] = createSignal(false)
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
    const atBottom = scroll.scrollTop >= Math.max(0, scroll.scrollHeight - scroll.viewport.height)
    const next = timelinePosition(turns as { y: number }[], scroll.viewport.y, atBottom)
    setPosition((previous) =>
      previous.active === next.active &&
      previous.previous === next.previous &&
      previous.next === next.next &&
      previous.atBottom === atBottom
        ? previous
        : { ...next, atBottom },
    )
  }
  onMount(() => {
    update()
    onCleanup(scheduleTuiInterval(update, { name: "session-timeline-rail", delayMs: 200, unref: true }))
  })
  const ticks = createMemo(() => timelineWindow(props.turns.length, height(), position().active, position().atBottom))
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
  function time(index: number | undefined) {
    const turn = index === undefined ? undefined : props.turns[index]
    if (!turn || !Number.isFinite(turn.time.created)) return ""
    const date = new Date(turn.time.created)
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
  }
  // Full preview card only on tick hover; the time-only label stays for the rest of the rail.
  const card = createMemo(() => {
    const index = hover()
    if (index === undefined) return null
    const tick = ticks().find((tick) => tick.index === index)
    if (!tick) return null
    return timelineCard({
      preview: props.turns[index]?.preview ?? "",
      timeLabel: time(index),
      termWidth: dimensions().width,
      tickRow: tick.row,
      railHeight: height(),
    })
  })
  const label = createMemo(() => {
    if (!railHovered() || card()) return ""
    return time(hover() ?? position().active)
  })
  return (
    <box
      width={2}
      flexShrink={0}
      onMouseOver={() => setRailHovered(true)}
      onMouseOut={() => {
        setHover(undefined)
        setRailHovered(false)
      }}
      onMouseScroll={(event) => {
        const scroll = props.scroll()
        if (!isRenderableAlive(scroll)) return
        scroll.processMouseEvent(event)
        event.stopPropagation()
      }}
    >
      <Show when={ticks().length}>
        <text
          position="absolute"
          top={(ticks()[0]?.row ?? 1) - 1}
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
              width={2}
              fg={tick.index === position().active || hover() === tick.index ? theme.text : theme.textMuted}
              selectable={false}
              onMouseOver={() => setHover(tick.index)}
              onMouseOut={() => setHover(undefined)}
              onMouseUp={() => jump(tick.index)}
            >
              {tick.index === position().active ? "━━" : hover() === tick.index ? "──" : " ─"}
            </text>
          )}
        </For>
        <text
          position="absolute"
          top={(ticks().at(-1)?.row ?? 0) + 1}
          fg={position().next >= 0 ? theme.textMuted : theme.border}
          selectable={false}
          onMouseUp={() => jump(position().next)}
        >
          {" "}
          ▾
        </text>
        <Show when={card()}>
          {(card) => (
            <box
              position="absolute"
              right={3}
              top={card().top}
              width={card().width}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={theme.backgroundPanel}
              borderColor={theme.border}
              border={["top", "right", "bottom", "left"]}
              customBorderChars={RoundedBorder}
              flexDirection="column"
            >
              <text fg={theme.textMuted} selectable={false}>
                {time(hover())}
              </text>
              <For each={card().lines}>
                {(line) => (
                  <text fg={theme.text} selectable={false}>
                    {line}
                  </text>
                )}
              </For>
            </box>
          )}
        </Show>
        <Show when={label()}>
          <text
            position="absolute"
            right={3}
            top={ticks().find((tick) => tick.index === (hover() ?? position().active))?.row ?? 0}
            width={5}
            bg={theme.background}
            fg={theme.textMuted}
            selectable={false}
          >
            {label()}
          </text>
        </Show>
      </Show>
    </box>
  )
}
