import { TextAttributes } from "@ax-code/opentui-core"
import type { RGBA } from "@ax-code/opentui-core"
import { For, Show, createMemo } from "solid-js"
import { gradientLineRuns } from "./color"
import { useVisualCapability } from "./capability-context"

// Multi-line text with a truecolor gradient interpolated between two theme
// tokens (ADR-031). Runs are precomputed per (lines, colors) — zero
// per-frame cost. Non-truecolor terminals render the fallback color.
export function GradientText(props: {
  lines: string[]
  from: RGBA
  to: RGBA
  fallback: RGBA
  bold?: boolean
  selectable?: boolean
  // Extra columns of ramp phase per row; > 0 tilts the gradient diagonally.
  diagonalBias?: number
}) {
  const { capability } = useVisualCapability()
  const attributes = () => (props.bold ? TextAttributes.BOLD : undefined)
  const runs = createMemo(() => {
    const width = props.lines.reduce((max, line) => Math.max(max, line.length), 0)
    return props.lines.map((line, row) =>
      gradientLineRuns({
        line,
        row,
        rows: props.lines.length,
        width,
        from: props.from,
        to: props.to,
        diagonalBias: props.diagonalBias,
      }),
    )
  })
  return (
    <box>
      <Show
        when={capability().truecolor}
        fallback={
          <For each={props.lines}>
            {(line) => (
              <text fg={props.fallback} attributes={attributes()} selectable={props.selectable ?? false}>
                {line}
              </text>
            )}
          </For>
        }
      >
        <For each={runs()}>
          {(lineRuns) => (
            <text attributes={attributes()} selectable={props.selectable ?? false}>
              <For each={lineRuns}>{(run) => <span style={{ fg: run.color }}>{run.text}</span>}</For>
            </text>
          )}
        </For>
      </Show>
    </box>
  )
}
