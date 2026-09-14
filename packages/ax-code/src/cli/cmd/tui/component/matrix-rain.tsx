import { For, createSignal, onCleanup, onMount } from "solid-js"
import { RGBA } from "ax-tui"
import { useKeyboard, useRenderer, useTerminalDimensions } from "ax-tui/solid"
import { scheduleTuiInterval, scheduleTuiTimeout } from "@tui/util/timer"
import {
  MATRIX_RAIN_DURATION_MS,
  MATRIX_RAIN_TICK_MS,
  bindHiddenTerminalCursor,
  createMatrixRain,
  matrixRainRows,
  tickMatrixRain,
  type MatrixRainState,
} from "./matrix-rain-view-model"

function useHiddenTerminalCursor() {
  const renderer = useRenderer()
  onMount(() => {
    const unbind = bindHiddenTerminalCursor(renderer)
    onCleanup(unbind)
  })
}

// Brightness ramp: index 0 is blank, index MATRIX_RAIN_LEVELS is the head.
// Deliberately a small fixed palette so consecutive cells collapse into few
// spans and the per-frame escape sequence volume stays bounded.
const LEVEL_COLORS: RGBA[] = [
  RGBA.fromInts(0, 0, 0),
  RGBA.fromInts(0, 80, 0),
  RGBA.fromInts(0, 150, 25),
  RGBA.fromInts(0, 215, 70),
  RGBA.fromInts(205, 255, 220),
]

const BACKGROUND = RGBA.fromInts(0, 0, 0)

/** Opaque cover so the main chrome never paints before startup rain. */
export function MatrixRainCover() {
  useHiddenTerminalCursor()
  const dimensions = useTerminalDimensions()
  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={BACKGROUND}
      onMouseDown={(evt) => evt.stopPropagation()}
    />
  )
}

/** `timeout` = played to completion; `skip` = the user dismissed it early. */
export type MatrixRainDoneReason = "timeout" | "skip"

export function MatrixRain(props: { durationMs?: number; onDone: (reason: MatrixRainDoneReason) => void }) {
  useHiddenTerminalCursor()
  const dimensions = useTerminalDimensions()
  const durationMs = props.durationMs ?? MATRIX_RAIN_DURATION_MS

  let state: MatrixRainState = createMatrixRain({
    width: dimensions().width,
    height: dimensions().height,
  })
  const [rows, setRows] = createSignal(matrixRainRows(state))

  const stopInterval = scheduleTuiInterval(
    () => {
      const size = dimensions()
      state = tickMatrixRain(state, size)
      setRows(matrixRainRows(state))
    },
    { name: "matrix-rain-tick", delayMs: MATRIX_RAIN_TICK_MS, unref: true },
  )

  const stopTimeout = scheduleTuiTimeout(() => props.onDone("timeout"), {
    name: "matrix-rain-timeout",
    delayMs: durationMs,
    unref: true,
  })

  onCleanup(() => {
    stopInterval()
    stopTimeout()
  })

  // Only Escape is consumed. Ordinary keys keep flowing to the prompt, so the
  // overlay never eats a keystroke the user did not aim at it.
  useKeyboard((evt) => {
    if (evt.name !== "escape") return
    evt.preventDefault()
    evt.stopPropagation()
    props.onDone("skip")
  })

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={BACKGROUND}
      onMouseDown={() => props.onDone("skip")}
    >
      <For each={rows()}>
        {(row) => (
          <text>
            {row.map((run) =>
              run.level === 0 ? run.text : <span style={{ fg: LEVEL_COLORS[run.level] }}>{run.text}</span>,
            )}
          </text>
        )}
      </For>
    </box>
  )
}
