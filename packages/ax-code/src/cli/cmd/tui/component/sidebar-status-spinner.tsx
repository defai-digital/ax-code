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
// Why this is a bespoke component and not just `<Spinner>` from
// component/spinner.tsx:
//
// opentui's native <spinner> element manages its own framebuffer and
// per-tick invalidation via requestRender(). That path works fine
// under regular <box> parents — see prompt's bottom-left scanner and
// the header AUTONOMOUS chip, both happy. It does NOT paint inside
// the sidebar's <scrollbox>: the spinner ticks and calls
// requestRender() but the frame never lands on screen (the renderer's
// dirty-region / culling pass through ContentRenderable does not pick
// it up). Verified manually — the first <Spinner> attempt painted
// exactly one frame and then froze.
//
// The opentui-side knob that does fix it is `Renderable.live = true`,
// which bumps the renderer's liveRequestCounter and forces continuous
// auto-render. We considered unifying on that and explicitly rejected
// it for THREE reasons, all rooted in source — recording them so the
// next person eyeing this code does not redo the spike:
//
//   1. opentui-spinner's SpinnerOptions explicitly Omits "live" from
//      RenderableOptions (see opentui-spinner/dist/index-9Y5uiGLf.d.mts
//      ~line 32). JSX `<spinner live={true}>` is a type error. That
//      omission is the upstream author's deliberate API choice, not
//      a gap to paper over.
//
//   2. Working around the Omit with `ref={(r) => r.live = true}`
//      compiles, but Renderable.destroy() does not decrement
//      _liveCount. Every busy→idle→busy cycle would leak one unit
//      of liveCount and eventually pin the entire renderer in
//      permanent auto-render. Manual onCleanup before unmount works
//      in theory; in practice it is the kind of invariant that gets
//      dropped on the next refactor.
//
//   3. `live` is by design an APP-WIDE switch — it puts the whole
//      tree into auto_started mode and defeats opentui's diff-based
//      paint strategy for every other renderable on screen while
//      the sidebar status is showing.
//
// The Solid-signal approach below avoids all three: it only dirties
// the <text> we own, it cleans up via standard onCleanup, and the
// cost is one signal write per 40 ms while the spinner is mounted —
// strictly less work than `live=true` would do.
//
// Revisit ONLY if opentui ships a scoped "force-redraw-this-element"
// prop. Until then, this is the right tool for in-scrollbox spinners
// and Spinner / opentui native <spinner> is the right tool everywhere
// else.
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
