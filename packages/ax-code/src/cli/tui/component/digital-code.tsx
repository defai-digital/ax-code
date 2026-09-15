import { For, createSignal, onCleanup, onMount } from "solid-js"
import { RGBA, TextAttributes, resolveRenderLib } from "ax-tui"
import { useKeyboard, useRenderer, useTerminalDimensions } from "ax-tui/solid"
import { scheduleTuiInterval, scheduleTuiTimeout } from "@tui/util/timer"
import { captureTuiInput } from "@tui/util/capture-input"
import { digitalCodePixelPlayer, supportsDigitalCodePixels } from "./digital-code-pixels"
import { DIGITAL_CODE_LEVEL_COLORS } from "./digital-code-palette"
import {
  DIGITAL_CODE_DURATION_MS,
  DIGITAL_CODE_TICK_MS,
  bindHiddenTerminalCursor,
  createDigitalCode,
  digitalCodeRows,
  tickDigitalCode,
  type DigitalCodeDirection,
  type DigitalCodeState,
} from "./digital-code-view-model"

function useHiddenTerminalCursor() {
  const renderer = useRenderer()
  onMount(() => {
    const unbind = bindHiddenTerminalCursor(renderer)
    onCleanup(unbind)
  })
}

const BACKGROUND = RGBA.fromInts(0, 0, 0)

/** Opaque cover so the main chrome never paints before startup rain. */
export function DigitalCodeCover() {
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
export type DigitalCodeDoneReason = "timeout" | "skip"

export function DigitalCode(props: {
  durationMs?: number
  /** `up` is the reverse rain used by the exit flourish; defaults to the startup fall. */
  direction?: DigitalCodeDirection
  /** Swallow keys while the overlay is up. The exit flourish sets this so a
   * keystroke cannot start new work while the app is already shutting down. */
  captureInput?: boolean
  onDone: (reason: DigitalCodeDoneReason) => void
}) {
  useHiddenTerminalCursor()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const durationMs = props.durationMs ?? DIGITAL_CODE_DURATION_MS

  let state: DigitalCodeState = createDigitalCode({
    width: dimensions().width,
    height: dimensions().height,
    direction: props.direction,
  })
  const [rows, setRows] = createSignal(digitalCodeRows(state))
  let pixels: ReturnType<typeof digitalCodePixelPlayer> | undefined
  let pixelsFailed = false
  const clearPixels = () => {
    const active = pixels
    pixels = undefined
    try {
      active?.dispose()
    } catch {
      // A failed terminal output must not prevent overlay or exit teardown.
      pixelsFailed = true
    }
  }
  onCleanup(clearPixels)

  const stopInterval = scheduleTuiInterval(
    () => {
      const size = dimensions()
      state = tickDigitalCode(state, size)
      const resolution = renderer.resolution
      const supported =
        !pixelsFailed &&
        resolution &&
        resolution.width > 0 &&
        resolution.height > 0 &&
        supportsDigitalCodePixels({
          tty: process.stdout.isTTY === true,
          screenMode: renderer.screenMode,
          capabilities: renderer.capabilities,
        })
      if (supported) {
        try {
          pixels ??= digitalCodePixelPlayer((data) => {
            if (!renderer.isDestroyed) resolveRenderLib().writeOut(renderer.rendererPtr, data)
          })
          pixels.draw({
            width: resolution.width,
            height: resolution.height,
            columns: size.width,
            rows: size.height,
            direction: props.direction ?? "down",
          })
          return
        } catch {
          pixelsFailed = true
          clearPixels()
        }
      } else clearPixels()
      setRows(digitalCodeRows(state))
    },
    { name: "digital-code-tick", delayMs: DIGITAL_CODE_TICK_MS, unref: true },
  )

  const stopTimeout = scheduleTuiTimeout(() => props.onDone("timeout"), {
    name: "digital-code-timeout",
    delayMs: durationMs,
    unref: true,
  })

  onCleanup(() => {
    stopInterval()
    stopTimeout()
  })

  // Shutdown input must run before already registered global shortcuts, not
  // merely before focused renderables. Paste has a separate dispatch channel.
  onMount(() => {
    if (!props.captureInput) return
    onCleanup(captureTuiInput(renderer.keyInput, () => props.onDone("skip")))
  })

  // Opening playback preserves ordinary input and yields to selection.
  useKeyboard((evt) => {
    if (props.captureInput) return
    if (evt.name === "escape") {
      evt.preventDefault()
      evt.stopPropagation()
      props.onDone("skip")
      return
    }
    if (renderer.hasSelection) props.onDone("skip")
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
                    fg: DIGITAL_CODE_LEVEL_COLORS[run.hue][run.level],
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
