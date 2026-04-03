import { Button } from "@ax-code/ui/button"
import type { Prompt } from "@/context/prompt"
import { For, Show, type JSX } from "solid-js"

export type QuickStart = {
  id: string
  label: string
  text: string
}

export function quickStarts(t: (key: string, params?: Record<string, string | number>) => string): QuickStart[] {
  return [
    {
      id: "plan",
      label: t("quickstart.plan"),
      text: t("quickstart.plan.prompt"),
    },
    {
      id: "build",
      label: t("quickstart.build"),
      text: t("quickstart.build.prompt"),
    },
    {
      id: "debug",
      label: t("quickstart.debug"),
      text: t("quickstart.debug.prompt"),
    },
    {
      id: "review",
      label: t("quickstart.review"),
      text: t("quickstart.review.prompt"),
    },
    {
      id: "explain",
      label: t("quickstart.explain"),
      text: t("quickstart.explain.prompt"),
    },
    {
      id: "tests",
      label: t("quickstart.tests"),
      text: t("quickstart.tests.prompt"),
    },
  ]
}

export function quickPrompt(text: string): Prompt {
  return [{ type: "text", content: text, start: 0, end: text.length }]
}

export function QuickStarts(props: {
  list: QuickStart[]
  onPick: (item: QuickStart) => void
  title?: JSX.Element
  note?: JSX.Element
  compact?: boolean
  class?: string
}) {
  return (
    <div class={`flex flex-col gap-3 ${props.class ?? ""}`}>
      <Show when={props.title || props.note}>
        <div class="flex flex-col gap-1">
          <Show when={props.title}>
            <div class="text-12-medium text-text-weak">{props.title}</div>
          </Show>
          <Show when={props.note}>
            <div class="text-12-regular text-text-base">{props.note}</div>
          </Show>
        </div>
      </Show>
      <div class="flex flex-wrap gap-2">
        <For each={props.list}>
          {(item) => (
            <Button
              type="button"
              size={props.compact ? "small" : "normal"}
              variant="secondary"
              class="rounded-full px-3"
              onClick={() => props.onPick(item)}
            >
              {item.label}
            </Button>
          )}
        </For>
      </div>
    </div>
  )
}
