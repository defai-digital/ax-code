import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js"
import type { PermissionRequest } from "@ax-code/sdk/v2"
import { Button } from "@ax-code/ui/button"
import { DockPrompt } from "@ax-code/ui/dock-prompt"
import { Icon } from "@ax-code/ui/icon"
import { useLanguage } from "@/context/language"

export function SessionPermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  batchCount?: number
  batchResponding?: boolean
  onDecide: (response: "once" | "always" | "reject") => void
  onDecideBatch?: (response: "once" | "reject") => void
}) {
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)

  const label = (key: string) => {
    const value = language.t(key as Parameters<typeof language.t>[0])
    if (value === key) return ""
    return value
  }

  const title = () => {
    return label(`settings.permissions.tool.${props.request.permission}.title`) || props.request.permission
  }

  const desc = () => {
    const key = `settings.permissions.tool.${props.request.permission}.description`
    const value = language.t(key as Parameters<typeof language.t>[0])
    if (value === key) return ""
    return value
  }

  const meta = createMemo(() => props.request.metadata ?? {})
  const list = createMemo(() => [...new Set(props.request.patterns.filter((item) => !!item))])
  const keep = createMemo(() => [...new Set(props.request.always.filter((item) => !!item))])
  const extra = createMemo(() => keep().filter((item) => !list().includes(item)))
  const kind = createMemo(() => {
    switch (props.request.permission) {
      case "read":
      case "glob":
      case "grep":
      case "list":
      case "todoread":
      case "lsp":
      case "skill":
        return "read"
      case "webfetch":
      case "websearch":
      case "codesearch":
        return "network"
      case "task":
        return "agent"
      case "doom_loop":
        return "guard"
      default:
        return "write"
    }
  })
  const line = createMemo(() => {
    const data = meta()

    if (props.request.permission === "edit") {
      const value = typeof data.filepath === "string" ? data.filepath : list()[0]
      if (!value) return
      return { label: language.t("session.permission.meta.path"), value }
    }

    if (props.request.permission === "read") {
      const value = typeof data.filePath === "string" ? data.filePath : list()[0]
      if (!value) return
      return { label: language.t("session.permission.meta.path"), value }
    }

    if (props.request.permission === "list") {
      const value = typeof data.path === "string" ? data.path : list()[0]
      if (!value) return
      return { label: language.t("session.permission.meta.path"), value }
    }

    if (props.request.permission === "glob" || props.request.permission === "grep") {
      const value = typeof data.pattern === "string" ? data.pattern : list()[0]
      if (!value) return
      return { label: language.t("session.permission.meta.pattern"), value }
    }

    if (props.request.permission === "bash") {
      const value = typeof data.command === "string" ? data.command : list()[0]
      if (!value) return
      return { label: language.t("session.permission.meta.command"), value }
    }

    if (props.request.permission === "task") {
      const value =
        typeof data.description === "string"
          ? data.description
          : typeof data.subagent_type === "string"
            ? data.subagent_type
            : list()[0]
      if (!value) return
      return { label: language.t("session.permission.meta.task"), value }
    }

    if (props.request.permission === "webfetch") {
      const value = typeof data.url === "string" ? data.url : list()[0]
      if (!value) return
      return { label: language.t("session.permission.meta.url"), value }
    }

    if (props.request.permission === "websearch" || props.request.permission === "codesearch") {
      const value = typeof data.query === "string" ? data.query : list()[0]
      if (!value) return
      return { label: language.t("session.permission.meta.query"), value }
    }

    if (props.request.permission === "external_directory") {
      const value =
        typeof data.parentDir === "string"
          ? data.parentDir
          : typeof data.filepath === "string"
            ? data.filepath
            : list()[0]
      if (!value) return
      return { label: language.t("session.permission.meta.path"), value }
    }

    return undefined
  })
  const details = createMemo(() => list().length > 0 || extra().length > 0)
  const future = createMemo(() => {
    if (keep().length === 1 && keep()[0] === "*") {
      return language.t("session.permission.future.all", { tool: title() })
    }
    if (extra().length === 0 && keep().length === 0) {
      return language.t("session.permission.future.none")
    }
    return language.t(
      keep().length === 1 ? "session.permission.future.some.one" : "session.permission.future.some.other",
      { count: keep().length },
    )
  })
  const batch = createMemo(() => Math.max(0, (props.batchCount ?? 0) - 1))

  return (
    <DockPrompt
      kind="permission"
      header={
        <div data-slot="permission-row" data-variant="header">
          <span data-slot="permission-icon">
            <Icon name="warning" size="normal" />
          </span>
          <div class="min-w-0 flex items-center gap-2 flex-wrap">
            <div data-slot="permission-header-title">{language.t("notification.permission.title")}</div>
            <div class="rounded-full bg-surface-raised-base px-2 py-0.5 text-11-medium text-text-base">
              {language.t(`session.permission.kind.${kind()}` as Parameters<typeof language.t>[0])}
            </div>
          </div>
        </div>
      }
      footer={
        <>
          <div class="min-w-0 py-1 text-12-regular text-text-weak">
            <Show when={props.responding} fallback={future()}>
              {language.t("session.permission.saving")}
            </Show>
          </div>
          <div data-slot="permission-footer-actions" class="flex-wrap gap-2">
            <Button variant="ghost" size="normal" onClick={() => props.onDecide("reject")} disabled={props.responding}>
              {language.t("session.permission.action.reject")}
            </Button>
            <Button
              variant="secondary"
              size="normal"
              onClick={() => props.onDecide("always")}
              disabled={props.responding}
            >
              {language.t("session.permission.action.always")}
            </Button>
            <Button variant="primary" size="normal" onClick={() => props.onDecide("once")} disabled={props.responding}>
              {language.t("session.permission.action.once")}
            </Button>
          </div>
          <Show when={batch() > 0 && props.onDecideBatch}>
            <div class="pt-1 flex flex-col gap-2">
              <div class="text-12-regular text-text-weak">
                {language.t(
                  batch() === 1 ? "session.permission.batch.summary.one" : "session.permission.batch.summary.other",
                  { count: batch(), tool: title() },
                )}
              </div>
              <div data-slot="permission-footer-actions" class="flex-wrap gap-2">
                <Button
                  variant="ghost"
                  size="normal"
                  onClick={() => props.onDecideBatch?.("reject")}
                  disabled={props.responding || props.batchResponding}
                >
                  {language.t("session.permission.batch.action.reject")}
                </Button>
                <Button
                  variant="secondary"
                  size="normal"
                  onClick={() => props.onDecideBatch?.("once")}
                  disabled={props.responding || props.batchResponding}
                >
                  {language.t("session.permission.batch.action.once")}
                </Button>
              </div>
            </div>
          </Show>
        </>
      }
    >
      <div class="flex flex-col gap-3">
        <div class="rounded-lg border border-border-weaker-base bg-background-base/60 px-3 py-2.5 flex flex-col gap-2">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex flex-col gap-1">
              <div class="text-14-medium text-text-strong">
                {language.t("session.permission.summary", { tool: title() })}
              </div>
              <Show when={desc()}>
                <div data-slot="permission-hint">{desc()}</div>
              </Show>
            </div>
            <div class="rounded-full bg-surface-raised-base px-2 py-0.5 text-11-medium text-text-base shrink-0">
              {language.t(list().length === 1 ? "session.permission.request.one" : "session.permission.request.other", {
                count: list().length || 1,
              })}
            </div>
          </div>

          <Show when={line()}>
            {(item) => (
              <div class="rounded-md bg-surface-raised-base px-2.5 py-2">
                <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">{item().label}</div>
                <code class="mt-1 block text-12-regular text-text-base break-all whitespace-pre-wrap">
                  {item().value}
                </code>
              </div>
            )}
          </Show>

          <div class="flex flex-wrap gap-2">
            <div class="rounded-full bg-surface-base px-2 py-0.5 text-11-medium text-text-base">
              {language.t("session.permission.note.once")}
            </div>
            <div class="rounded-full bg-surface-base px-2 py-0.5 text-11-medium text-text-base">{future()}</div>
            <Show when={batch() > 0}>
              <div class="rounded-full bg-surface-base px-2 py-0.5 text-11-medium text-text-base">
                {language.t(
                  batch() === 1 ? "session.permission.batch.summary.one" : "session.permission.batch.summary.other",
                  { count: batch(), tool: title() },
                )}
              </div>
            </Show>
          </div>
        </div>

        <Show when={details()}>
          <div class="flex flex-col gap-2">
            <button
              type="button"
              class="self-start text-12-medium text-text-weak hover:text-text-base transition-colors"
              onClick={() => setOpen((value) => !value)}
            >
              {language.t(open() ? "session.permission.hideDetails" : "session.permission.showDetails")}
            </button>
            <Show when={open()}>
              <div class="rounded-lg border border-border-weaker-base bg-background-base/40 px-3 py-3 flex flex-col gap-3">
                <Show when={list().length > 0}>
                  <div class="flex flex-col gap-1.5">
                    <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">
                      {language.t("session.permission.detail.request")}
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <For each={list()}>
                        {(item) => (
                          <code class="text-12-regular text-text-base break-all whitespace-pre-wrap">{item}</code>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                <Show when={extra().length > 0 || keep().includes("*")}>
                  <div class="flex flex-col gap-1.5">
                    <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">
                      {language.t("session.permission.detail.future")}
                    </div>
                    <Switch>
                      <Match when={keep().length === 1 && keep()[0] === "*"}>
                        <div class="text-12-regular text-text-base">
                          {language.t("session.permission.future.all", { tool: title() })}
                        </div>
                      </Match>
                      <Match when={true}>
                        <div class="flex flex-col gap-1.5">
                          <For each={extra()}>
                            {(item) => (
                              <code class="text-12-regular text-text-base break-all whitespace-pre-wrap">{item}</code>
                            )}
                          </For>
                        </div>
                      </Match>
                    </Switch>
                  </div>
                </Show>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </DockPrompt>
  )
}
