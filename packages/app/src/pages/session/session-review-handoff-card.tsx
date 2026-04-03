import { Button } from "@ax-code/ui/button"
import { For, Show } from "solid-js"
import { useLanguage } from "@/context/language"

export function SessionReviewHandoffCard(props: {
  centered: boolean
  title: string
  summary?: string
  files: number
  additions: number
  deletions: number
  risks: string[]
  steps: string[]
  onOpenReview: () => void
  onRunChecks: () => void
  onCopySummary: () => void
}) {
  const language = useLanguage()

  return (
    <div class="shrink-0 w-full px-3 pb-2 pointer-events-none">
      <div
        classList={{
          "w-full pointer-events-auto": true,
          "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered,
        }}
      >
        <div class="rounded-xl border border-border-weak-base bg-background-base/90 px-4 py-3 shadow-[var(--shadow-xs-border-base)] backdrop-blur-sm flex flex-col gap-3">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div class="min-w-0 flex flex-col gap-1">
              <div class="text-12-medium text-text-weak">{language.t("session.handoff.eyebrow")}</div>
              <div class="text-14-medium text-text-strong">{props.title}</div>
              <Show when={props.summary}>
                <div class="text-13-regular text-text-base">{props.summary}</div>
              </Show>
            </div>
            <div class="flex flex-wrap items-center gap-2 shrink-0">
              <Chip
                value={language.t(
                  props.files === 1 ? "session.handoff.metric.files.one" : "session.handoff.metric.files.other",
                  { count: props.files },
                )}
              />
              <Chip value={language.t("session.handoff.metric.additions", { count: props.additions })} />
              <Chip value={language.t("session.handoff.metric.deletions", { count: props.deletions })} />
            </div>
          </div>

          <div class="grid gap-3 lg:grid-cols-2">
            <Section title={language.t("session.handoff.open.title")} items={props.risks} />
            <Section title={language.t("session.handoff.verify.title")} items={props.steps} />
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <Button type="button" size="small" variant="secondary" icon="open-file" onClick={props.onOpenReview}>
              {language.t("session.handoff.action.review")}
            </Button>
            <Button type="button" size="small" variant="ghost" icon="check" onClick={props.onRunChecks}>
              {language.t("session.handoff.action.checks")}
            </Button>
            <Button type="button" size="small" variant="ghost" icon="copy" onClick={() => void props.onCopySummary()}>
              {language.t("session.handoff.action.copy")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Section(props: { title: string; items: string[] }) {
  return (
    <div class="rounded-lg border border-border-weaker-base bg-surface-base/70 px-3 py-2.5 flex flex-col gap-2">
      <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">{props.title}</div>
      <div class="flex flex-col gap-1.5">
        <For each={props.items}>
          {(item) => (
            <div class="flex items-start gap-2">
              <div class="mt-1 size-1.5 rounded-full shrink-0 bg-border-strong-base" />
              <div class="text-12-regular text-text-base">{item}</div>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

function Chip(props: { value: string }) {
  return (
    <div class="rounded-full border border-border-weaker-base bg-surface-base px-2.5 py-1 text-11-medium text-text-base">
      {props.value}
    </div>
  )
}
