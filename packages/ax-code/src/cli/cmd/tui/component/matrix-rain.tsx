import { For, createSignal, onCleanup, onMount } from "solid-js"
import { RGBA, TextAttributes } from "ax-tui"
import { useKeyboard, useRenderer, useTerminalDimensions } from "ax-tui/solid"
import { scheduleTuiInterval, scheduleTuiTimeout } from "@tui/util/timer"
import { MATRIX_RAIN_LEVEL_COLORS } from "./matrix-rain-palette"
import {
  MATRIX_RAIN_DURATION_MS,
  MATRIX_RAIN_TICK_MS,
  bindHiddenTerminalCursor,
  createMatrixRain,
  matrixRainRows,
  tickMatrixRain,
  type MatrixRainDirection,
  type MatrixRainState,
} from "./matrix-rain-view-model"

function useHiddenTerminalCursor() {
  const renderer = useRenderer()
  onMount(() => {
    const unbind = bindHiddenTerminalCursor(renderer)
    onCleanup(unbind)
  })
}

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

export function MatrixRain(props: {
  durationMs?: number
  /** `up` is the reverse rain used by the exit flourish; defaults to the startup fall. */
  direction?: MatrixRainDirection
  /** Swallow keys while the overlay is up. The exit flourish sets this so a
   * keystroke cannot start new work while the app is already shutting down. */
  captureInput?: boolean
  onDone: (reason: MatrixRainDoneReason) => void
}) {
  useHiddenTerminalCursor()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const durationMs = props.durationMs ?? MATRIX_RAIN_DURATION_MS

  let state: MatrixRainState = createMatrixRain({
    width: dimensions().width,
    height: dimensions().height,
    direction: props.direction,
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
  // overlay never eats a keystroke the user did not aim at it — which includes
  // keyboard selections: the moment one exists under the cover, yield instead
  // of hiding it.
  useKeyboard((evt) => {
    if (evt.name === "escape") {
      evt.preventDefault()
      evt.stopPropagation()
      props.onDone("skip")
      return
    }
    // The exit flourish swallows keys so nothing can start work while the app
    // is already shutting down, but ctrl+c stays an escape hatch: pressing it
    // again is how people force an immediate quit.
    if (props.captureInput && evt.ctrl && evt.name === "c") {
      evt.preventDefault()
      evt.stopPropagation()
      props.onDone("skip")
      return
    }
    if (renderer.hasSelection) {
      props.onDone("skip")
      return
    }
    if (props.captureInput) {
      evt.preventDefault()
      evt.stopPropagation()
    }
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
              run.level === 0 ? (
                run.text
              ) : (
                <span
                  style={{
                    fg: MATRIX_RAIN_LEVEL_COLORS[run.level],
                    attributes: run.bold ? TextAttributes.BOLD : undefined,
                  }}
                >
                  {run.text}
                </span>
              ),
            )}
          </text>
        )}
      </For>
    </box>
  )
}
