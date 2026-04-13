import type { SessionDreSnapshot } from "@ax-code/sdk/v2"
import { For, Show, createMemo, splitProps, type ComponentProps, type JSX } from "solid-js"
import { Card, CardDescription, CardTitle } from "./card"
import { ScrollView } from "./scroll-view"
import { Tag } from "./tag"
import { sessionInsightDuration, sessionInsightVariant, sessionTimelineTone } from "./session-insight.logic"

export interface SessionDreProps extends Omit<ComponentProps<typeof Card>, "children" | "title" | "variant"> {
  snapshot: SessionDreSnapshot
  title?: JSX.Element
}

export function SessionDre(props: SessionDreProps) {
  const [local, rest] = splitProps(props, ["snapshot", "title", "class", "classList"])
  const detail = createMemo(() => local.snapshot.detail)
  const timeline = createMemo(() => local.snapshot.timeline)

  return (
    <Card
      {...rest}
      variant={sessionInsightVariant(detail()?.level)}
      class={local.class}
      classList={local.classList}
      data-component="session-dre"
    >
      <div class="space-y-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 space-y-1">
            <CardTitle icon="brain">{local.title ?? "DRE"}</CardTitle>
            <CardDescription>{detail()?.summary ?? "No execution graph recorded."}</CardDescription>
          </div>
          <Show when={detail()}>
            {(value) => (
              <div class="flex flex-wrap items-center gap-2">
                <Tag>{`${value().level.toLowerCase()} ${value().score}/100`}</Tag>
                <Tag>{`decision ${value().scorecard.total.toFixed(2)}`}</Tag>
              </div>
            )}
          </Show>
        </div>

        <Show
          when={detail()}
          fallback={
            <ScrollView class="max-h-44 rounded-md border px-3 py-2">
              <div class="space-y-1 font-mono text-xs">
                <For each={timeline()}>
                  {(line) => <div style={{ color: sessionTimelineTone(line.kind) }}>{line.text}</div>}
                </For>
              </div>
            </ScrollView>
          }
        >
          {(value) => (
            <div class="space-y-4">
              <div class="space-y-1 rounded-md border px-3 py-3">
                <div class="text-sm font-medium">{value().plan}</div>
                <div class="text-sm opacity-80">{value().stats}</div>
                <div class="text-xs opacity-70">
                  {`${sessionInsightDuration(value().duration)} · ${value().tokens.input}/${value().tokens.output} tokens`}
                </div>
              </div>

              <Show when={value().notes.length > 0 || value().drivers.length > 0}>
                <div class="grid gap-3 md:grid-cols-2">
                  <Show when={value().notes.length > 0}>
                    <div class="space-y-2">
                      <div class="text-xs font-medium uppercase opacity-60">Notes</div>
                      <div class="space-y-1 text-sm">
                        <For each={value().notes}>{(note) => <div>{note}</div>}</For>
                      </div>
                    </div>
                  </Show>
                  <Show when={value().drivers.length > 0}>
                    <div class="space-y-2">
                      <div class="text-xs font-medium uppercase opacity-60">Drivers</div>
                      <div class="space-y-1 text-sm">
                        <For each={value().drivers}>{(driver) => <div>{driver}</div>}</For>
                      </div>
                    </div>
                  </Show>
                </div>
              </Show>

              <div class="space-y-2">
                <div class="text-xs font-medium uppercase opacity-60">Decision Score</div>
                <div class="grid gap-2 md:grid-cols-2">
                  <For each={value().scorecard.breakdown}>
                    {(item) => (
                      <div class="rounded-md border px-3 py-2">
                        <div class="flex items-center justify-between gap-2">
                          <div class="text-sm font-medium">{item.label}</div>
                          <Tag>{item.value.toFixed(2)}</Tag>
                        </div>
                        <div class="mt-1 text-xs opacity-70">{item.detail}</div>
                      </div>
                    )}
                  </For>
                </div>
              </div>

              <div class="grid gap-3 md:grid-cols-2">
                <div class="space-y-2">
                  <div class="text-xs font-medium uppercase opacity-60">Routes</div>
                  <div class="space-y-1 text-sm">
                    <Show when={value().routes.length > 0} fallback={<div class="opacity-70">No route changes</div>}>
                      <For each={value().routes}>
                        {(route) => <div>{`${route.from} → ${route.to} (${route.confidence.toFixed(2)})`}</div>}
                      </For>
                    </Show>
                  </div>
                </div>
                <div class="space-y-2">
                  <div class="text-xs font-medium uppercase opacity-60">Tools</div>
                  <div class="space-y-1 text-sm">
                    <Show when={value().tools.length > 0} fallback={<div class="opacity-70">No tool calls</div>}>
                      <For each={value().tools}>{(tool, idx) => <div>{`${idx() + 1}. ${tool}`}</div>}</For>
                    </Show>
                  </div>
                </div>
              </div>

              <div class="space-y-2">
                <div class="text-xs font-medium uppercase opacity-60">Timeline</div>
                <ScrollView class="max-h-48 rounded-md border px-3 py-2">
                  <div class="space-y-1 font-mono text-xs">
                    <For each={timeline()}>
                      {(line) => <div style={{ color: sessionTimelineTone(line.kind) }}>{line.text}</div>}
                    </For>
                  </div>
                </ScrollView>
              </div>
            </div>
          )}
        </Show>
      </div>
    </Card>
  )
}
