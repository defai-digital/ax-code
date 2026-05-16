import type { SessionCompareResult } from "@ax-code/sdk/v2"
import { For, Show, splitProps, type ComponentProps, type JSX } from "solid-js"
import { Card, CardDescription, CardTitle } from "./card"
import { Tag } from "./tag"
import {
  sessionCompareDelta,
  sessionCompareFacts,
  sessionCompareLead,
  sessionInsightVariant,
} from "./session-insight.logic"

export interface SessionCompareProps extends Omit<ComponentProps<typeof Card>, "children" | "title" | "variant"> {
  result: SessionCompareResult
  title?: JSX.Element
  leftLabel?: string
  rightLabel?: string
}

export function SessionCompare(props: SessionCompareProps) {
  const [local, rest] = splitProps(props, ["result", "title", "leftLabel", "rightLabel", "class", "classList"])
  const left = () => local.result.session1
  const right = () => local.result.session2

  return (
    <Card
      {...rest}
      variant={sessionInsightVariant(
        local.result.advisory.winner === "A"
          ? left().risk.level
          : local.result.advisory.winner === "B"
            ? right().risk.level
            : undefined,
      )}
      class={local.class}
      classList={local.classList}
      data-component="session-compare"
    >
      <div class="space-y-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 space-y-1">
            <CardTitle icon="branch">{local.title ?? "Execution Compare"}</CardTitle>
            <CardDescription>{sessionCompareLead(local.result)}</CardDescription>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Tag>{`confidence ${local.result.advisory.confidence.toFixed(2)}`}</Tag>
            <Tag>
              {local.result.advisory.winner === "tie" ? "tie" : `prefer ${local.result.advisory.winner.toLowerCase()}`}
            </Tag>
          </div>
        </div>

        <Show when={local.result.advisory.reasons.length > 0}>
          <div class="space-y-2">
            <div class="text-xs font-medium uppercase opacity-60">Reasons</div>
            <div class="space-y-1 text-sm">
              <For each={local.result.advisory.reasons}>{(reason) => <div>{reason}</div>}</For>
            </div>
          </div>
        </Show>

        <div class="grid gap-3 lg:grid-cols-2">
          <For
            each={[
              { label: local.leftLabel ?? "A", summary: left() },
              { label: local.rightLabel ?? "B", summary: right() },
            ]}
          >
            {(item) => (
              <div class="space-y-3 rounded-md border px-3 py-3">
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div class="space-y-1">
                    <div class="text-xs font-medium uppercase opacity-60">{item.label}</div>
                    <div class="text-sm font-medium">{item.summary.title}</div>
                  </div>
                  <Tag>{`${item.summary.risk.level.toLowerCase()} ${item.summary.risk.score}/100`}</Tag>
                </div>
                <div class="text-sm">{item.summary.headline}</div>
                <div class="text-sm opacity-80">{item.summary.plan}</div>
                <div class="flex flex-wrap gap-2 text-xs opacity-70">
                  <For each={sessionCompareFacts(item.summary)}>{(fact) => <span>{fact}</span>}</For>
                </div>
                <Show when={item.summary.risk.summary}>
                  <div class="text-xs opacity-70">{item.summary.risk.summary}</div>
                </Show>
              </div>
            )}
          </For>
        </div>

        <div class="space-y-2">
          <div class="text-xs font-medium uppercase opacity-60">Differences</div>
          <div class="flex flex-wrap gap-2 text-sm">
            <For each={sessionCompareDelta(local.result)}>{(item) => <Tag>{item}</Tag>}</For>
          </div>
        </div>

        <Show when={local.result.replay}>
          {(value) => (
            <div class="space-y-2">
              <div class="text-xs font-medium uppercase opacity-60">Replay</div>
              <div class="grid gap-3 lg:grid-cols-2">
                <For
                  each={[
                    { label: local.leftLabel ?? "A", replay: value().session1 },
                    { label: local.rightLabel ?? "B", replay: value().session2 },
                  ]}
                >
                  {(item) => (
                    <div class="space-y-2 rounded-md border px-3 py-3">
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="text-sm font-medium">{item.label}</div>
                        <Tag>{`${item.replay.divergences} divergences`}</Tag>
                      </div>
                      <div class="text-xs opacity-70">{`${item.replay.stepsCompared} steps compared`}</div>
                      <Show when={item.replay.reasons.length > 0}>
                        <div class="space-y-1 text-sm">
                          <For each={item.replay.reasons}>{(reason) => <div>{reason}</div>}</For>
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </div>
          )}
        </Show>
      </div>
    </Card>
  )
}
