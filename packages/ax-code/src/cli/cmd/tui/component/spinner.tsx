import { Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import "@tui/renderer-adapter/opentui"
import type { JSX } from "@tui/renderer-adapter/opentui"
import type { RGBA } from "@tui/renderer-adapter/opentui"

const frames = ["|", "/", "-", "\\"]

export function Spinner(props: { children?: JSX.Element; color?: RGBA }) {
  const { theme } = useTheme()
  const kv = useKV()
  const color = () => props.color ?? theme.textMuted
  return (
    <Show when={kv.get("animations_enabled", true)} fallback={<text fg={color()}>... {props.children}</text>}>
      <box flexDirection="row" gap={1}>
        <spinner frames={frames} interval={80} color={color()} />
        <Show when={props.children}>
          <text fg={color()}>{props.children}</text>
        </Show>
      </box>
    </Show>
  )
}
