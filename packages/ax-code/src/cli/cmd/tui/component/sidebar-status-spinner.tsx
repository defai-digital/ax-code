import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js"
import type { RGBA } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import { shouldUseTuiAnimations } from "./spinner-profile"
import { createColors, createFrames } from "../ui/spinner"

// Knight Rider scanner sized for the session sidebar's narrow status
// line. Visually matches the prompt's bottom-left scanner (same
// createFrames/createColors backend, same "blocks" style) so the two
// liveness cues feel like one design language.
//
// IMPORTANT: this component does NOT use the opentui native <spinner>
// element. opentui spinners manage their own framebuffer and rely on
// the parent compositor polling them every frame — that polling does
// not happen for native children of a <scrollbox>, so the sidebar
// status spinner painted exactly one frame and then froze (verified
// in manual testing against the original Spinner). Driving frame
// updates from a Solid signal forces a real re-render of the parent
// <text> on every tick, which the scrollbox does observe, so this
// indicator is guaranteed to actually animate inside the sidebar.
//
// Cost: one Solid signal write per 40 ms while the spinner is mounted.
// Cheap compared to the painted output.
const SCANNER_WIDTH = 6
const SCANNER_INTERVAL_MS = 40

export function SidebarStatusSpinner(props: { children?: JSX.Element; color?: RGBA }) {
  const { theme } = useTheme()
  const kv = useKV()
  const headColor = () => props.color ?? theme.warning
  const animationsOn = () => shouldUseTuiAnimations({ userEnabled: kv.get("animations_enabled", true) })

  // createFrames returns the per-frame glyph strings; createColors
  // returns a ColorGenerator(frameIndex, charIndex, totalFrames,
  // totalChars) → RGBA. We pass the same options to both so frame N's
  // char K colour is in sync with that char's glyph state.
  const config = createMemo(() => {
    const options = {
      color: headColor(),
      style: "blocks" as const,
      width: SCANNER_WIDTH,
      inactiveFactor: 0.4,
      minAlpha: 0.3,
    }
    return {
      frames: createFrames(options),
      color: createColors(options),
    }
  })

  const [frameIndex, setFrameIndex] = createSignal(0)

  onMount(() => {
    if (!animationsOn()) return
    const timer = setInterval(() => {
      setFrameIndex((i) => (i + 1) % config().frames.length)
    }, SCANNER_INTERVAL_MS)
    onCleanup(() => clearInterval(timer))
  })

  const chars = createMemo(() => {
    const c = config()
    const idx = frameIndex() % c.frames.length
    return Array.from(c.frames[idx] ?? "")
  })

  return (
    <text wrapMode="none">
      <For each={chars()}>
        {(char, charIdx) => (
          <span
            style={{
              fg: config().color(frameIndex(), charIdx(), config().frames.length, SCANNER_WIDTH),
            }}
          >
            {char}
          </span>
        )}
      </For>
      <Show when={props.children}>
        <span> </span>
        <span style={{ fg: headColor() }}>{props.children}</span>
      </Show>
    </text>
  )
}
