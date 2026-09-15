import { For, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { RGBA } from "ax-tui"
import { useKeyboard, useRenderer, useTerminalDimensions } from "ax-tui/solid"
import { scheduleTuiInterval, scheduleTuiTimeout } from "@tui/util/timer"
import { logo } from "@/cli/logo"
import { DIGITAL_CODE_LEVEL_COLORS } from "./digital-code-palette"
import {
  STARTUP_LOGO_DURATION_MS,
  STARTUP_LOGO_TICK_MS,
  bindHiddenTerminalCursor,
  createStartupLogoGlyphs,
  startupLogoFrame,
  startupLogoPadding,
} from "./digital-code-view-model"

const BACKGROUND = RGBA.fromInts(0, 0, 0)

// The banner is padded to a fixed column count; measuring trimmed lines keeps
// the horizontal centering exact regardless of that trailing padding.
const LOGO_WIDTH = logo.reduce((max, line) => Math.max(max, line.trimEnd().length), 0)

// The drop schedule is drawn once per launch, so every run assembles the mark
// in a different order.
const GLYPHS = createStartupLogoGlyphs({ lines: logo })

/**
 * Brand beat between the startup rain and the working screen: every character
 * of the ASCII mark drops on its own randomized schedule and warms from the
 * dim neon tail to the bright highlight as it lands, then the mark holds for a beat
 * before handing off. Covers the screen so the main chrome never flashes
 * before the app is revealed. Escape or a click skips straight to the app;
 * ordinary keys still reach the prompt behind it.
 */
export function StartupLogo(props: { durationMs?: number; onDone: () => void }) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()

  onMount(() => {
    const unbind = bindHiddenTerminalCursor(renderer)
    onCleanup(unbind)
  })

  const anchor = createMemo(() =>
    startupLogoPadding({
      contentWidth: LOGO_WIDTH,
      contentHeight: logo.length,
      width: dimensions().width,
      height: dimensions().height,
    }),
  )

  // Rebuilding a frame per tick is cheap: the schedule is fixed and only the
  // positions and brightness of the same glyphs change.
  const [elapsedMs, setElapsedMs] = createSignal(0)
  const frame = createMemo(() =>
    startupLogoFrame({
      glyphs: GLYPHS,
      elapsedMs: elapsedMs(),
      blockLeft: anchor().paddingLeft,
      blockTop: anchor().paddingTop,
      width: dimensions().width,
      height: dimensions().height,
    }),
  )

  let elapsed = 0
  const stopInterval = scheduleTuiInterval(
    () => {
      elapsed += STARTUP_LOGO_TICK_MS
      setElapsedMs(elapsed)
      if (elapsed >= STARTUP_LOGO_DURATION_MS) stopInterval()
    },
    { name: "startup-logo-tick", delayMs: STARTUP_LOGO_TICK_MS, unref: true },
  )

  const stopTimeout = scheduleTuiTimeout(() => props.onDone(), {
    name: "startup-logo-timeout",
    delayMs: props.durationMs ?? STARTUP_LOGO_DURATION_MS,
    unref: true,
  })
  onCleanup(() => {
    stopInterval()
    stopTimeout()
  })

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      evt.preventDefault()
      evt.stopPropagation()
      props.onDone()
      return
    }
    // Keys pass through to the prompt, so a keyboard selection can grow under
    // the cover. Yield as soon as one exists instead of hiding it.
    if (renderer.hasSelection) props.onDone()
  })

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={BACKGROUND}
      overflow="hidden"
      onMouseDown={() => props.onDone()}
    >
      <box position="absolute" left={0} top={frame().top} width={dimensions().width}>
        <For each={frame().rows}>
          {(row) => (
            <text>
              <For each={row}>
                {(run) =>
                  run.level === 0 ? (
                    run.text
                  ) : (
                    <span style={{ fg: DIGITAL_CODE_LEVEL_COLORS[run.hue][run.level] }}>{run.text}</span>
                  )
                }
              </For>
            </text>
          )}
        </For>
      </box>
    </box>
  )
}
