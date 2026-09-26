import { textSceneRows, textSceneBackground, isTextSceneStyle, type SceneRun } from "./text-scene-view-model"
import { foliageCells, isFoliageVariant, type OverlayStyle } from "./foliage-view-model"
import { For, Show, createSignal, onCleanup, onMount } from "solid-js"
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
  style?: OverlayStyle
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
  const foliageVariant = isFoliageVariant(props.style) ? props.style : undefined
  const scene = isTextSceneStyle(props.style) ? props.style : undefined
  const started = performance.now()
  const [leafRows, setLeafRows] = createSignal<SceneRun[][]>(
    scene
      ? textSceneRows(dimensions().width, dimensions().height, scene, 0)
      : foliageVariant
        ? foliageCells(
            dimensions().width * 8,
            dimensions().height * 16,
            foliageVariant,
            0,
            dimensions().width,
            dimensions().height,
          )
        : [],
  )
  let pixels: ReturnType<typeof digitalCodePixelPlayer> | undefined
  let pixelsFailed = false
  let finished = false
  const writePixels = (data: string) => {
    // Frame failures must reach the caller so it can switch to text. Only
    // deletion may bypass the native queue during renderer teardown.
    if (!data.startsWith("\x1b_Ga=d,")) {
      if (renderer.isDestroyed) throw new Error("Animation renderer has been destroyed")
      resolveRenderLib().writeOut(renderer.rendererPtr, data)
      return
    }
    try {
      if (!renderer.isDestroyed) {
        resolveRenderLib().writeOut(renderer.rendererPtr, data)
        return
      }
    } catch {
      // Fall through to stdout so a teardown race still deletes the image.
    }
    if (process.stdout.writable === false || process.stdout.destroyed) return
    try {
      process.stdout.write(data)
    } catch {
      // Best effort — overlay teardown must continue.
    }
  }
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
  onCleanup(() => {
    finished = true
    clearPixels()
  })

  let stopTimeout = () => {}
  const stopInterval = scheduleTuiInterval(
    () => {
      if (finished) return
      const size = dimensions()
      state = tickDigitalCode(state, size)
      const now = performance.now()
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
          pixels ??= digitalCodePixelPlayer(writePixels)
          pixels.draw({
            width: resolution.width,
            height: resolution.height,
            columns: size.width,
            rows: size.height,
            direction: props.direction ?? "down",
            style: props.style,
            elapsedMs: now - started,
          })
          return
        } catch {
          pixelsFailed = true
          clearPixels()
        }
      } else clearPixels()
      if (scene) setLeafRows(textSceneRows(size.width, size.height, scene, now - started))
      else if (foliageVariant)
        setLeafRows(
          foliageCells(size.width * 8, size.height * 16, foliageVariant, now - started, size.width, size.height),
        )
      else setRows(digitalCodeRows(state))
    },
    { name: "digital-code-tick", delayMs: DIGITAL_CODE_TICK_MS, unref: true },
  )

  const finish = (reason: DigitalCodeDoneReason) => {
    if (finished) return
    finished = true
    stopInterval()
    stopTimeout()
    // Delete the Kitty image before chrome returns. Waiting for unmount
    // races renderer.destroy() and leaves a Ghostty remnant.
    clearPixels()
    props.onDone(reason)
  }

  stopTimeout = scheduleTuiTimeout(() => finish("timeout"), {
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
    onCleanup(captureTuiInput(renderer.keyInput, () => finish("skip")))
  })

  // Opening playback preserves ordinary input and yields to selection.
  useKeyboard((evt) => {
    if (props.captureInput) return
    if (evt.name === "escape") {
      evt.preventDefault()
      evt.stopPropagation()
      finish("skip")
      return
    }
    if (renderer.hasSelection) finish("skip")
  })

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={scene ? RGBA.fromHex(textSceneBackground(scene)) : BACKGROUND}
      onMouseDown={() => finish("skip")}
    >
      <Show when={foliageVariant || scene}>
        <For each={leafRows()}>
          {(row) => (
            <text>
              {row.map((run) => (
                <span
                  style={{ fg: RGBA.fromHex(run.color), bg: run.background ? RGBA.fromHex(run.background) : undefined }}
                >
                  {run.text}
                </span>
              ))}
            </text>
          )}
        </For>
      </Show>
      <Show when={!foliageVariant && !scene}>
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
      </Show>
    </box>
  )
}
