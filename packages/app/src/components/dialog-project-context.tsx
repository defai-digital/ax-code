import { useMutation } from "@tanstack/solid-query"
import { DateTime } from "luxon"
import { createMemo, createResource, For, Match, Show, Switch, type Component } from "solid-js"
import { Button } from "@ax-code/ui/button"
import { Dialog } from "@ax-code/ui/dialog"
import { Tag } from "@ax-code/ui/tag"
import { showToast } from "@ax-code/ui/toast"
import {
  type ProjectContextFile,
  type ProjectContextInfo,
  type ProjectContextTemplate,
  useProjectContextRequest,
} from "@/components/project-context-data"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"

export const DialogProjectContext: Component = () => {
  const server = useServer()
  const platform = usePlatform()
  const language = useLanguage()
  const request = useProjectContextRequest()
  const [info, actions] = createResource(() => request<ProjectContextInfo>("/context"))

  const fail = (err: unknown) => {
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: err instanceof Error ? err.message : String(err),
    })
  }

  const refresh = useMutation(() => ({
    mutationFn: () => request("/context/memory/warmup", { method: "POST" }),
    onSuccess: () => {
      actions.refetch()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("session.context.memory.refreshed.title"),
      })
    },
    onError: fail,
  }))

  const clear = useMutation(() => ({
    mutationFn: () => request("/context/memory", { method: "DELETE" }),
    onSuccess: () => {
      actions.refetch()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("session.context.memory.cleared.title"),
      })
    },
    onError: fail,
  }))

  const create = useMutation(() => ({
    mutationFn: (key: ProjectContextTemplate["key"]) =>
      request<ProjectContextTemplate>("/context/template", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ key }),
      }),
    onSuccess: (item) => {
      actions.refetch()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("session.context.template.created.title"),
        description: item.path,
      })
      void open(item.path)
    },
    onError: fail,
  }))

  const pending = createMemo(() => refresh.isPending || clear.isPending || create.isPending)
  const canOpen = createMemo(() => !!platform.openPath && server.isLocal())

  const relative = (value: string) => {
    const time = DateTime.fromISO(value)
    if (!time.isValid) return value
    return time.setLocale(language.intl()).toRelative() ?? time.toLocaleString(DateTime.DATETIME_MED)
  }

  const scopeLabel = (scope: ProjectContextFile["scope"]) =>
    language.t(scope === "project" ? "session.context.scope.project" : "session.context.scope.global")

  const write = async (value: string) => {
    const body = typeof document === "undefined" ? undefined : document.body
    if (body) {
      const area = document.createElement("textarea")
      area.value = value
      area.setAttribute("readonly", "")
      area.style.position = "fixed"
      area.style.opacity = "0"
      area.style.pointerEvents = "none"
      body.appendChild(area)
      area.select()
      const copied = document.execCommand("copy")
      body.removeChild(area)
      if (copied) return true
    }

    const clip = typeof navigator === "undefined" ? undefined : navigator.clipboard
    if (!clip?.writeText) return false
    return clip.writeText(value).then(
      () => true,
      () => false,
    )
  }

  const copy = async (value: string) => {
    const ok = await write(value)
    if (!ok) throw new Error(language.t("toast.session.share.copyFailed.title"))

    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("session.share.copy.copied"),
      description: value,
    })
  }

  const open = async (value: string) => {
    try {
      if (canOpen() && platform.openPath) {
        await platform.openPath(value)
        return
      }
      await copy(value)
    } catch (err) {
      fail(err)
    }
  }

  return (
    <Dialog
      size="large"
      title={language.t("session.context.title")}
      description={language.t("session.context.description")}
      action={
        <Button
          type="button"
          class="h-7 -my-1 text-14-medium"
          tabIndex={-1}
          disabled={pending()}
          onClick={() => void refresh.mutateAsync()}
        >
          {language.t("session.context.memory.refresh")}
        </Button>
      }
    >
      <div class="flex flex-col gap-5">
        <Switch>
          <Match when={info.error}>
            <div class="text-14-regular text-text-weak">
              {info.error instanceof Error ? info.error.message : language.t("common.requestFailed")}
            </div>
          </Match>
          <Match when={info()} keyed>
            {(data) => (
              <>
                <div class="rounded-xl border border-border-weak-base bg-background-base p-3 flex flex-col gap-2">
                  <div class="text-13-medium text-text-strong">{language.t("session.context.root")}</div>
                  <div class="text-12-regular text-text-base break-all">{data.worktree}</div>
                  <Show when={data.directory !== data.worktree}>
                    <div class="flex flex-col gap-1">
                      <div class="text-13-medium text-text-strong">{language.t("session.context.directory")}</div>
                      <div class="text-12-regular text-text-base break-all">{data.directory}</div>
                    </div>
                  </Show>
                </div>

                <div class="rounded-xl border border-border-weak-base bg-background-base p-3 flex flex-col gap-3">
                  <div class="flex items-center justify-between gap-3">
                    <div class="text-14-medium text-text-strong">{language.t("session.context.memory.title")}</div>
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      disabled={pending() || !data.memory}
                      onClick={() => void clear.mutateAsync()}
                    >
                      {language.t("session.context.memory.clear")}
                    </Button>
                  </div>
                  <Show
                    when={data.memory}
                    fallback={
                      <div class="text-12-regular text-text-weak">{language.t("session.context.memory.empty")}</div>
                    }
                  >
                    {(memory) => (
                      <div class="flex flex-col gap-2">
                        <div class="flex flex-wrap items-center gap-2">
                          <Tag>{language.t("session.context.memory.tokens", { count: memory().totalTokens })}</Tag>
                          <Show when={memory().sections.length > 0}>
                            <For each={memory().sections}>{(item) => <Tag>{item}</Tag>}</For>
                          </Show>
                        </div>
                        <div class="text-12-regular text-text-base">
                          {language.t("session.context.memory.updated", { time: relative(memory().lastUpdated) })}
                        </div>
                        <div class="text-12-regular text-text-weak break-all">
                          {language.t("session.context.hash")}: {memory().contentHash.slice(0, 12)}
                        </div>
                      </div>
                    )}
                  </Show>
                </div>

                <Section
                  title={language.t("session.context.files.title")}
                  items={data.files}
                  scopeLabel={scopeLabel}
                  actionLabel={language.t("common.open")}
                  copyLabel={language.t("session.context.copyPath")}
                  missingLabel={language.t("session.context.state.missing")}
                  onOpen={(item) => void open(item.path)}
                  onCopy={(item) => void copy(item.path).catch(fail)}
                />

                <Section
                  title={language.t("session.context.instructions.title")}
                  items={data.instructions}
                  scopeLabel={scopeLabel}
                  actionLabel={language.t("common.open")}
                  copyLabel={language.t("session.context.copyPath")}
                  missingLabel={language.t("session.context.state.missing")}
                  onOpen={(item) => void open(item.path)}
                  onCopy={(item) => void copy(item.path).catch(fail)}
                />

                <TemplateSection
                  title={language.t("session.context.templates.title")}
                  note={language.t("session.context.templates.description")}
                  items={data.templates}
                  createLabel={language.t("session.context.template.create")}
                  openLabel={language.t("common.open")}
                  copyLabel={language.t("session.context.copyPath")}
                  kindLabel={(kind) =>
                    language.t(
                      kind === "instruction"
                        ? "session.context.template.kind.instruction"
                        : "session.context.template.kind.checklist",
                    )
                  }
                  disabled={pending()}
                  onCreate={(item) => void create.mutateAsync(item.key)}
                  onOpen={(item) => void open(item.path)}
                  onCopy={(item) => void copy(item.path).catch(fail)}
                />
              </>
            )}
          </Match>
          <Match when={true}>
            <div class="text-14-regular text-text-weak">{language.t("common.loading")}</div>
          </Match>
        </Switch>
      </div>
    </Dialog>
  )
}

function TemplateSection(props: {
  title: string
  note: string
  items: ProjectContextTemplate[]
  createLabel: string
  openLabel: string
  copyLabel: string
  disabled?: boolean
  kindLabel: (kind: ProjectContextTemplate["kind"]) => string
  onCreate: (item: ProjectContextTemplate) => void
  onOpen: (item: ProjectContextTemplate) => void
  onCopy: (item: ProjectContextTemplate) => void
}) {
  return (
    <div class="rounded-xl border border-border-weak-base bg-background-base p-3 flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <div class="text-14-medium text-text-strong">{props.title}</div>
        <div class="text-12-regular text-text-weak">{props.note}</div>
      </div>
      <div class="flex flex-col gap-2">
        <For each={props.items}>
          {(item) => (
            <div class="rounded-lg border border-border-weaker-base px-3 py-2 flex items-start justify-between gap-3">
              <div class="min-w-0 flex flex-col gap-1">
                <div class="flex flex-wrap items-center gap-2">
                  <div class="text-12-medium text-text-strong">{item.title}</div>
                  <Tag>{props.kindLabel(item.kind)}</Tag>
                  <Show when={item.exists}>
                    <Tag>{item.path.endsWith("/AGENTS.md") ? "AGENTS.md" : "docs"}</Tag>
                  </Show>
                </div>
                <div class="text-12-regular text-text-base">{item.description}</div>
                <div class="text-12-regular text-text-weak break-all">{item.path}</div>
              </div>
              <div class="shrink-0 flex items-center gap-2">
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  disabled={props.disabled}
                  onClick={() => (item.exists ? props.onOpen(item) : props.onCreate(item))}
                >
                  {item.exists ? props.openLabel : props.createLabel}
                </Button>
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  disabled={props.disabled}
                  onClick={() => props.onCopy(item)}
                >
                  {props.copyLabel}
                </Button>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

function Section(props: {
  title: string
  items: ProjectContextFile[]
  scopeLabel: (scope: ProjectContextFile["scope"]) => string
  actionLabel: string
  copyLabel: string
  missingLabel: string
  onOpen: (item: ProjectContextFile) => void
  onCopy: (item: ProjectContextFile) => void
}) {
  return (
    <div class="rounded-xl border border-border-weak-base bg-background-base p-3 flex flex-col gap-3">
      <div class="text-14-medium text-text-strong">{props.title}</div>
      <div class="flex flex-col gap-2">
        <For each={props.items}>
          {(item) => (
            <div class="rounded-lg border border-border-weaker-base px-3 py-2 flex items-start justify-between gap-3">
              <div class="min-w-0 flex flex-col gap-1">
                <div class="flex flex-wrap items-center gap-2">
                  <code class="text-12-medium text-text-strong">{item.name}</code>
                  <Tag>{props.scopeLabel(item.scope)}</Tag>
                  <Show when={!item.exists}>
                    <Tag>{props.missingLabel}</Tag>
                  </Show>
                </div>
                <div class="text-12-regular text-text-base break-all">{item.path}</div>
              </div>
              <div class="shrink-0 flex items-center gap-2">
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  onClick={() => (item.exists ? props.onOpen(item) : props.onCopy(item))}
                >
                  {item.exists ? props.actionLabel : props.copyLabel}
                </Button>
                <Button type="button" size="small" variant="ghost" onClick={() => props.onCopy(item)}>
                  {props.copyLabel}
                </Button>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
