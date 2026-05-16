import type {
  ExecutionGraph,
  ExecutionGraphTopologyLine,
  SessionCompareResult,
  SessionDreSnapshot,
  SessionRollbackPoint,
} from "@ax-code/sdk/v2"
import { Show, splitProps } from "solid-js"
import { SessionCompare } from "./session-compare"
import { SessionDre } from "./session-dre"
import { SessionGraph } from "./session-graph"
import { SessionRollback } from "./session-rollback"

export interface SessionInsightsProps {
  dre?: SessionDreSnapshot | null
  graph?: ExecutionGraph | null
  topology?: ExecutionGraphTopologyLine[] | null
  compare?: SessionCompareResult | null
  rollback?: SessionRollbackPoint[] | null
  leftLabel?: string
  rightLabel?: string
  selectedStep?: number
  onSelect?: (point: SessionRollbackPoint) => void
  actionLabel?: string
  class?: string
  classList?: Record<string, boolean | undefined>
}

export function SessionInsights(props: SessionInsightsProps) {
  const [local] = splitProps(props, [
    "dre",
    "graph",
    "topology",
    "compare",
    "rollback",
    "leftLabel",
    "rightLabel",
    "selectedStep",
    "onSelect",
    "actionLabel",
    "class",
    "classList",
  ])

  if (!local.dre && !local.graph && !local.compare && !Array.isArray(local.rollback)) return null

  return (
    <div data-component="session-insights" class={local.class} classList={local.classList}>
      <Show when={local.compare}>
        <SessionCompare
          result={local.compare!}
          leftLabel={local.leftLabel}
          rightLabel={local.rightLabel}
          data-slot="session-insights-compare"
        />
      </Show>
      <Show when={local.graph}>
        <SessionGraph graph={local.graph!} topology={local.topology ?? undefined} data-slot="session-insights-graph" />
      </Show>
      <Show when={local.dre}>
        <SessionDre snapshot={local.dre!} data-slot="session-insights-dre" />
      </Show>
      <Show when={Array.isArray(local.rollback)}>
        <SessionRollback
          points={local.rollback ?? []}
          selectedStep={local.selectedStep}
          onSelect={local.onSelect}
          actionLabel={local.actionLabel}
          data-slot="session-insights-rollback"
        />
      </Show>
    </div>
  )
}
