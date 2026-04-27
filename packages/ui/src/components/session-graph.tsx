import type { ExecutionGraph, ExecutionGraphTopologyLine } from "@ax-code/sdk/v2"
import { For, Show, createMemo, splitProps, type ComponentProps, type JSX } from "solid-js"
import { Card, CardDescription, CardTitle } from "./card"
import { ScrollView } from "./scroll-view"
import { Tag } from "./tag"
import { sessionGraphLayout } from "./session-graph.logic"

export interface SessionGraphProps extends Omit<ComponentProps<typeof Card>, "children" | "title" | "variant"> {
  graph?: ExecutionGraph | null
  topology?: ExecutionGraphTopologyLine[] | null
  title?: JSX.Element
}

function tone(type: ExecutionGraph["nodes"][number]["type"], critical: boolean) {
  if (critical) {
    return {
      fill: "color-mix(in oklab, var(--icon-info-active) 18%, var(--surface-primary))",
      stroke: "var(--icon-info-active)",
      text: "var(--text-primary)",
    }
  }
  if (type === "error") {
    return {
      fill: "color-mix(in oklab, var(--icon-critical-base) 12%, var(--surface-primary))",
      stroke: "var(--icon-critical-base)",
      text: "var(--text-primary)",
    }
  }
  if (type === "llm") {
    return {
      fill: "color-mix(in oklab, var(--icon-success-active) 10%, var(--surface-primary))",
      stroke: "var(--icon-success-active)",
      text: "var(--text-primary)",
    }
  }
  if (type === "tool_call" || type === "tool_result") {
    return {
      fill: "color-mix(in oklab, var(--icon-warning-active) 10%, var(--surface-primary))",
      stroke: "var(--border-primary)",
      text: "var(--text-primary)",
    }
  }
  return {
    fill: "var(--surface-secondary)",
    stroke: "var(--border-primary)",
    text: "var(--text-primary)",
  }
}

function edge(type: ExecutionGraph["edges"][number]["type"]) {
  if (type === "call_result") return "var(--icon-warning-active)"
  if (type === "step_contains") return "var(--border-secondary)"
  return "var(--border-primary)"
}

function sessionEdgePath(item: {
  x1: number
  y1: number
  x2: number
  y2: number
}) {
  const span = Math.max(0, item.x2 - item.x1)
  const curveX = Math.max(28, Math.min(72, Math.round(span / 4)))
  const laneColumn = Math.floor(item.x1 / 88)
  const isWide = span > 176
  const curveY = isWide ? ((laneColumn % 2 === 0 ? -1 : 1) * 36) : 0

  return `M ${item.x1} ${item.y1} C ${item.x1 + curveX} ${item.y1 + curveY}, ${item.x2 - curveX} ${item.y2 + curveY}, ${item.x2} ${item.y2}`
}

export function SessionGraph(props: SessionGraphProps) {
  const [local, rest] = splitProps(props, ["graph", "topology", "title", "class", "classList"])
  const lay = createMemo(() => (local.graph ? sessionGraphLayout(local.graph, local.topology) : undefined))

  return (
    <Card {...rest} variant="normal" class={local.class} classList={local.classList} data-component="session-graph">
      <div class="space-y-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 space-y-1">
            <CardTitle icon="branch">{local.title ?? "Execution Graph"}</CardTitle>
            <CardDescription>{lay()?.path ?? "No execution graph recorded."}</CardDescription>
          </div>
          <Show when={local.graph}>
            {(value) => (
              <div class="flex flex-wrap items-center gap-2">
                <Tag>{`${value().nodes.length} nodes`}</Tag>
                <Tag>{`${value().edges.length} edges`}</Tag>
              </div>
            )}
          </Show>
        </div>

        <Show
          when={lay()}
          fallback={<div class="rounded-md border px-3 py-3 text-sm opacity-70">No execution graph recorded.</div>}
        >
          {(value) => (
            <div class="space-y-3">
              <div class="flex flex-wrap gap-2 text-xs opacity-70">
                <span>Critical path highlighted</span>
                <span>Solid links = sequence</span>
                <span>Gold links = call/result</span>
                <span>Dashed links = step scope</span>
              </div>
              <ScrollView class="session-graph-scroll">
                <svg
                  class="session-graph-canvas"
                  width={value().width}
                  height={value().height}
                  viewBox={`0 0 ${value().width} ${value().height}`}
                  role="img"
                  aria-label="Execution graph"
                >
                  <For each={value().edges}>
                    {(item) => {
                      const path = sessionEdgePath(item)
                      return (
                        <path
                          d={path}
                          fill="none"
                          stroke={edge(item.type)}
                          stroke-width={item.type === "call_result" ? 2 : 1.5}
                          stroke-dasharray={item.type === "step_contains" ? "5 4" : undefined}
                          opacity={0.9}
                        />
                      )
                    }}
                  </For>
                  <For each={value().nodes}>
                    {(item) => {
                      const style = tone(item.type, item.critical)
                      return (
                        <g transform={`translate(${item.x}, ${item.y})`}>
                          <rect
                            rx="8"
                            ry="8"
                            width={item.w}
                            height={item.h}
                            fill={style.fill}
                            stroke={style.stroke}
                            stroke-width={item.critical ? 2 : 1.25}
                          />
                          <text x="12" y="20" fill={style.text} font-size="12" font-weight="600">
                            <For each={item.lines}>
                              {(line, idx) => (
                                <tspan x="12" dy={idx() === 0 ? 0 : 14}>
                                  {line}
                                </tspan>
                              )}
                            </For>
                          </text>
                        </g>
                      )
                    }}
                  </For>
                </svg>
              </ScrollView>
            </div>
          )}
        </Show>
      </div>
    </Card>
  )
}
