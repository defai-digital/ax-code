import { Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import type { JSX } from "@ax-code/opentui-solid"
import type { RGBA } from "@ax-code/opentui-core"
import type { ColorGenerator } from "@ax-code/opentui-spinner"
import "@ax-code/opentui-spinner/solid"
import { shouldUseTuiAnimations } from "./spinner-profile"

const frames = ["|", "/", "-", "\\"]

export function OpenTuiSpinner(props: { frames: string[]; interval: number; color: RGBA | ColorGenerator }) {
  return <spinner frames={props.frames} interval={props.interval} color={props.color} />
}

export function Spinner(props: { children?: JSX.Element; color?: RGBA }) {
  const { theme } = useTheme()
  const kv = useKV()
  const color = () => props.color ?? theme.textMuted
  return (
    <Show
      when={shouldUseTuiAnimations({ userEnabled: kv.get("animations_enabled", true) })}
      fallback={<text fg={color()}>... {props.children}</text>}
    >
      <box flexDirection="row" gap={1}>
        <OpenTuiSpinner frames={frames} interval={80} color={color()} />
        <Show when={props.children}>
          <text fg={color()}>{props.children}</text>
        </Show>
      </box>
    </Show>
  )
}
