import type { SessionRollbackPoint } from "@ax-code/sdk/v2"
import { For, Show, splitProps, type ComponentProps, type JSX } from "solid-js"
import { Card, CardDescription, CardTitle } from "./card"
import { ScrollView } from "./scroll-view"
import { Tag } from "./tag"
import { sessionRollbackFacts, sessionRollbackLead, sessionRollbackToolLead } from "./session-insight.logic"

export interface SessionRollbackProps
  extends Omit<ComponentProps<typeof Card>, "children" | "onSelect" | "title" | "variant"> {
  points: SessionRollbackPoint[]
  title?: JSX.Element
  selectedStep?: number
  onSelect?: (point: SessionRollbackPoint) => void
  actionLabel?: string
}

export function SessionRollback(props: SessionRollbackProps) {
  const [local, rest] = splitProps(props, [
    "points",
    "title",
    "selectedStep",
    "onSelect",
    "actionLabel",
    "class",
    "classList",
  ])

  return (
    <Card
      {...rest}
      variant={local.points.length > 0 ? "warning" : "normal"}
      class={local.class}
      classList={local.classList}
      data-component="session-rollback"
    >
      <div class="space-y-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 space-y-1">
            <CardTitle icon="reset">{local.title ?? "Rollback"}</CardTitle>
            <CardDescription>{sessionRollbackLead(local.points)}</CardDescription>
          </div>
          <Show when={local.selectedStep != null}>
            <Tag>{`step ${local.selectedStep}`}</Tag>
          </Show>
        </div>

        <Show
          when={local.points.length > 0}
          fallback={<div class="rounded-md border px-3 py-3 text-sm opacity-70">No rollback points recorded.</div>}
        >
          <ScrollView class="max-h-72 rounded-md border px-2 py-2">
            <div class="space-y-2">
              <For each={local.points}>
                {(point) => {
                  const selected = () => local.selectedStep === point.step
                  return (
                    <button
                      type="button"
                      class="w-full rounded-md border px-3 py-3 text-left"
                      data-selected={selected() ? "true" : undefined}
                      style={
                        selected()
                          ? {
                              border: "1px solid var(--icon-warning-active)",
                              background: "color-mix(in oklab, var(--icon-warning-active) 12%, transparent)",
                            }
                          : undefined
                      }
                      onClick={() => local.onSelect?.(point)}
                    >
                      <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="min-w-0 space-y-1">
                          <div class="text-sm font-medium">{`Step ${point.step}`}</div>
                          <div class="flex flex-wrap gap-2 text-xs opacity-70">
                            <For each={sessionRollbackFacts(point)}>{(item) => <span>{item}</span>}</For>
                          </div>
                          <div class="text-sm opacity-80">{sessionRollbackToolLead(point)}</div>
                        </div>
                        <Show when={local.onSelect}>
                          <Tag>{selected() ? "selected" : (local.actionLabel ?? "restore")}</Tag>
                        </Show>
                      </div>

                      <Show when={point.tools.length > 0}>
                        <div class="mt-3 flex flex-wrap gap-2">
                          <For each={point.tools.slice(0, 3)}>{(tool) => <Tag>{tool}</Tag>}</For>
                          <Show when={point.tools.length > 3}>
                            <Tag>{`+${point.tools.length - 3} more`}</Tag>
                          </Show>
                        </div>
                      </Show>
                    </button>
                  )
                }}
              </For>
            </div>
          </ScrollView>
        </Show>
      </div>
    </Card>
  )
}
