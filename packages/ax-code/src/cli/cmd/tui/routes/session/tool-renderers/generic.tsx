import { createMemo, createSignal, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { detail } from "../format"
import { useSessionRouteContext } from "../context"
import { BlockTool, InlineTool, type ToolProps } from "./primitives"

export function GenericTool(props: ToolProps<any>) {
  const { theme } = useTheme()
  const ctx = useSessionRouteContext()
  const output = createMemo(() => props.output?.trim() ?? "")
  const [expanded, setExpanded] = createSignal(false)
  const lines = createMemo(() => output().split("\n"))
  const maxLines = 3
  const overflow = createMemo(() => lines().length > maxLines)
  const limited = createMemo(() => {
    if (expanded() || !overflow()) return output()
    return [...lines().slice(0, maxLines), "…"].join("\n")
  })

  return (
    <Show
      when={props.output && ctx.showGenericToolOutput()}
      fallback={
        <InlineTool icon="⚙" pending="Writing command..." complete={true} part={props.part}>
          {props.tool} {detail(props.input)}
        </InlineTool>
      }
    >
      <BlockTool
        title={`# ${props.tool} ${detail(props.input)}`}
        part={props.part}
        onClick={overflow() ? () => setExpanded((prev) => !prev) : undefined}
      >
        <box gap={1}>
          <text fg={theme.text}>{limited()}</text>
          <Show when={overflow()}>
            <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
          </Show>
        </box>
      </BlockTool>
    </Show>
  )
}
