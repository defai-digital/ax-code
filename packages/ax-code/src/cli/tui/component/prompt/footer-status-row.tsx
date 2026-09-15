import { type JSX, Show } from "solid-js"
import { KeyHint } from "@tui/ui/primitives/key-hint"
import { footerHintWidth } from "./footer-layout"

/** Keep the action visible; long status/retry content is clipped to its lane. */
export function FooterStatusRow(props: { width: number; interrupt?: string; children: JSX.Element }) {
  const width = () => Math.max(0, Math.floor(props.width))
  const hintWidth = () => (props.interrupt ? Math.min(width(), footerHintWidth("esc", props.interrupt)) : 0)
  const gap = () => (hintWidth() > 0 && width() > hintWidth() ? 1 : 0)
  return (
    <box flexDirection="row" width={width()} height={1} flexShrink={0} overflow="hidden" gap={gap()}>
      <box width={Math.max(0, width() - hintWidth() - gap())} height={1} flexShrink={0} overflow="hidden">
        {props.children}
      </box>
      <Show when={props.interrupt}>
        <box width={hintWidth()} height={1} flexShrink={0} overflow="hidden">
          <KeyHint keys="esc" label={props.interrupt!} noWrap />
        </box>
      </Show>
    </box>
  )
}
