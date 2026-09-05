import { Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import type { JSX } from "ax-tui/solid"
import type { RGBA } from "ax-tui"
import type { ColorGenerator } from "ax-tui/spinner"
import "ax-tui/spinner/solid"
import { shouldUseTuiAnimations } from "./spinner-profile"

const frames = ["|", "/", "-", "\\"]

export function AxTuiSpinner(props: { frames: string[]; interval: number; color: RGBA | ColorGenerator }) {
  return <spinner frames={props.frames} interval={props.interval} color={props.color} />
}

export function Spinner(props: { children?: JSX.Element; color?: RGBA; fallbackPrefix?: string }) {
  const { theme } = useTheme()
  const kv = useKV()
  const color = () => props.color ?? theme.textMuted
  const fallbackPrefix = () => props.fallbackPrefix ?? "... "
  return (
    <Show
      when={shouldUseTuiAnimations({ userEnabled: kv.get("animations_enabled", true) })}
      fallback={
        <text fg={color()}>
          {fallbackPrefix()}
          {props.children}
        </text>
      }
    >
      <box flexDirection="row" gap={1}>
        <AxTuiSpinner frames={frames} interval={80} color={color()} />
        <Show when={props.children}>
          <text fg={color()}>{props.children}</text>
        </Show>
      </box>
    </Show>
  )
}
