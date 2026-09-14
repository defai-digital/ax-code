import { For, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { RGBA, TextAttributes } from "ax-tui"
import { useKeyboard, useRenderer, useTerminalDimensions } from "ax-tui/solid"
import { scheduleTuiInterval, scheduleTuiTimeout } from "@tui/util/timer"
import { logo } from "@/cli/logo"
import {
  STARTUP_LOGO_DROP_DURATION_MS,
  STARTUP_LOGO_DURATION_MS,
  STARTUP_LOGO_TICK_MS,
  bindHiddenTerminalCursor,
  matrixRainRampRgb,
  startupLogoDropLevel,
  startupLogoDropOffset,
  startupLogoDropProgress,
  startupLogoPadding,
} from "./matrix-rain-view-model"

const BACKGROUND = RGBA.fromInts(0, 0, 0)

// The banner is padded to a fixed column count; measuring trimmed lines keeps
// the horizontal centering exact regardless of that trailing padding.
const LOGO_WIDTH = logo.reduce((max, line) => Math.max(max, line.trimEnd().length), 0)

/**
 * Brand beat between the startup rain and the working screen: the ASCII logo
 * falls in from above the top edge, eases into the vertical center, holds,
 * then hands off.
 * Covers the screen so the main chrome never flashes before the app is
 * revealed. Escape or a click skips straight to the app; ordinary keys still
 * reach the prompt behind it.
 */
export function StartupLogo(props: { durationMs?: number; onDone: () => void }) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()

  onMount(() => {
    const unbind = bindHiddenTerminalCursor(renderer)
    onCleanup(unbind)
  })

  // Horizontal centering is static; only the vertical offset animates.
  const paddingLeft = createMemo(
    () =>
      startupLogoPadding({
        contentWidth: LOGO_WIDTH,
        contentHeight: logo.length,
        width: dimensions().width,
        height: dimensions().height,
      }).paddingLeft,
  )

  // The mark falls from above the top edge to the centered row. Ticks stay
  // short so the fall reads as motion, and stop once it has landed to idle the
  // render. The offset is negative while it is still above the screen, which
  // the clipping parent hides.
  const [elapsedMs, setElapsedMs] = createSignal(0)
  const dropOffset = createMemo(() =>
    startupLogoDropOffset({
      progress: startupLogoDropProgress(elapsedMs()),
      contentHeight: logo.length,
      terminalHeight: dimensions().height,
    }),
  )

  // Same brightness ramp the rain trails use: the mark starts on the dim
  // green tail and brightens to the white head as it falls into place.
  const dropColor = createMemo(() => {
    const [r, g, b] = matrixRainRampRgb(startupLogoDropLevel(startupLogoDropProgress(elapsedMs())))
    return RGBA.fromInts(r, g, b)
  })

  let elapsed = 0
  const stopInterval = scheduleTuiInterval(
    () => {
      elapsed += STARTUP_LOGO_TICK_MS
      setElapsedMs(elapsed)
      if (elapsed >= STARTUP_LOGO_DROP_DURATION_MS) stopInterval()
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
    if (evt.name !== "escape") return
    evt.preventDefault()
    evt.stopPropagation()
    props.onDone()
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
      <box position="absolute" left={paddingLeft()} top={dropOffset()} width={LOGO_WIDTH} height={logo.length}>
        <For each={logo}>
          {(line) => (
            <text fg={dropColor()} attributes={TextAttributes.BOLD}>
              {line}
            </text>
          )}
        </For>
      </box>
    </box>
  )
}
