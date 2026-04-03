import type { Message, Session, SessionStatus, Todo } from "@ax-code/sdk/v2/client"
import { Icon } from "@ax-code/ui/icon"
import { Spinner } from "@ax-code/ui/spinner"
import { base64Encode } from "@ax-code/util/encode"
import { getFilename } from "@ax-code/util/path"
import { A } from "@solidjs/router"
import { type Accessor, createMemo, For, Show } from "solid-js"
import type { LocalProject } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { sessionPermissionRequest, sessionQuestionRequest } from "../session/composer/session-request-tree"
import { sortedRootSessions } from "./helpers"

type Kind = "attention" | "running" | "ready" | "error"

type Row = {
  kind: Kind
  dir: string
  id: string
  title: string
  note: string
  space: string
  at: number
  count?: number
}

const sort = (a: Row, b: Row) => b.at - a.at

const busy = (status: SessionStatus | undefined, msgs: Message[] | undefined) => {
  const wait = msgs?.findLast((item) => {
    return item.role === "assistant" && typeof (item as { time?: { completed?: unknown } }).time?.completed !== "number"
  })
  return (
    wait !== undefined ||
    status?.type === "busy" ||
    status?.type === "retry" ||
    (status !== undefined && status.type !== "idle")
  )
}

const todoNote = (list: Todo[], t: ReturnType<typeof useLanguage>["t"]) => {
  if (!list.length) return
  const done = list.filter((item) => item.status === "completed").length
  return t("sidebar.activity.item.todo", { done, total: list.length })
}

const errorNote = (err: unknown, t: ReturnType<typeof useLanguage>["t"]) => {
  if (typeof err === "string" && err) return err
  if (err && typeof err === "object" && "message" in err && typeof err.message === "string") return err.message
  if (err && typeof err === "object" && "name" in err && typeof err.name === "string") return err.name
  return t("notification.session.error.fallbackDescription")
}

export function ActivityInbox(props: {
  project: Accessor<LocalProject | undefined>
  dirs: Accessor<string[]>
  onClear: () => void
}) {
  const globalSync = useGlobalSync()
  const notification = useNotification()
  const permission = usePermission()
  const language = useLanguage()

  const rows = createMemo(() => {
    if (!props.project()?.worktree) return [] as Row[]

    return props.dirs().flatMap((dir): Row[] => {
      const [sync] = globalSync.child(dir, { bootstrap: false })
      const list = sortedRootSessions({ session: sync.session, path: { directory: dir } }, Date.now())

      return list.flatMap((session): Row[] => {
        const perm = sessionPermissionRequest(sync.session, sync.permission, session.id, (item) => {
          return !permission.autoResponds(item, dir)
        })
        const ask = sessionQuestionRequest(sync.session, sync.question, session.id)
        const unseen = notification.session.unseen(session.id)
        const ready = unseen.filter((item) => item.type === "turn-complete").length
        const err = unseen.find((item) => item.type === "error")
        const status = sync.session_status[session.id]
        const note = todoNote(sync.todo[session.id] ?? [], language.t)
        const space = getFilename(dir)
        const at = session.time.updated ?? session.time.created

        if (perm) {
          return [
            {
              kind: "attention" as const,
              dir,
              id: session.id,
              title: session.title ?? session.id,
              note: language.t("notification.permission.title"),
              space,
              at,
            },
          ]
        }

        if (ask) {
          return [
            {
              kind: "attention" as const,
              dir,
              id: session.id,
              title: session.title ?? session.id,
              note: language.t("notification.question.title"),
              space,
              at,
              count: ask.questions.length > 1 ? ask.questions.length : undefined,
            },
          ]
        }

        if (err) {
          return [
            {
              kind: "error" as const,
              dir,
              id: session.id,
              title: session.title ?? session.id,
              note: errorNote(err.error, language.t),
              space,
              at,
            },
          ]
        }

        if (busy(status, sync.message[session.id])) {
          return [
            {
              kind: "running" as const,
              dir,
              id: session.id,
              title: session.title ?? session.id,
              note:
                status?.type === "retry"
                  ? language.t("sidebar.activity.item.retry", { attempt: status.attempt })
                  : note || language.t("sidebar.activity.item.running"),
              space,
              at,
            },
          ]
        }

        if (!ready) return []

        return [
          {
            kind: "ready" as const,
            dir,
            id: session.id,
            title: session.title ?? session.id,
            note:
              ready === 1
                ? language.t("notification.session.responseReady.title")
                : language.t("sidebar.activity.item.ready", { count: ready }),
            space,
            at,
            count: ready > 1 ? ready : undefined,
          },
        ]
      })
    })
  })

  const groups = createMemo(() => {
    const all = rows()
    return {
      attention: all.filter((item) => item.kind === "attention").sort(sort),
      running: all.filter((item) => item.kind === "running").sort(sort),
      ready: all.filter((item) => item.kind === "ready").sort(sort),
      error: all.filter((item) => item.kind === "error").sort(sort),
    }
  })

  const total = createMemo(() => rows().length)
  const unseen = createMemo(() => props.dirs().reduce((sum, dir) => sum + notification.project.unseenCount(dir), 0))

  return (
    <Show when={total() > 0}>
      <div class="shrink-0 py-2" data-component="activity-inbox">
        <div class="rounded-xl border border-border-weak-base bg-background-base p-3 flex flex-col gap-3">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <div class="text-14-medium text-text-strong">{language.t("sidebar.activity.title")}</div>
              <div class="rounded-full bg-surface-raised-base px-2 py-0.5 text-11-medium text-text-base">{total()}</div>
            </div>
            <Show when={unseen() > 0}>
              <button
                type="button"
                class="text-12-medium text-text-weak hover:text-text-base transition-colors"
                onClick={props.onClear}
              >
                {language.t("sidebar.activity.clear")}
              </button>
            </Show>
          </div>

          <div class="flex flex-col gap-3 max-h-72 overflow-y-auto pr-0.5">
            <Group title={language.t("sidebar.activity.group.attention")} rows={groups().attention} />
            <Group title={language.t("sidebar.activity.group.running")} rows={groups().running} />
            <Group title={language.t("sidebar.activity.group.ready")} rows={groups().ready} />
            <Group title={language.t("sidebar.activity.group.error")} rows={groups().error} />
          </div>
        </div>
      </div>
    </Show>
  )
}

function Group(props: { title: string; rows: Row[] }) {
  const notification = useNotification()

  return (
    <Show when={props.rows.length > 0}>
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2 px-1">
          <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">{props.title}</div>
          <div class="h-px flex-1 bg-border-weaker-base" />
          <div class="text-11-medium text-text-weak">{props.rows.length}</div>
        </div>
        <div class="flex flex-col gap-1">
          <For each={props.rows}>
            {(row) => (
              <A
                href={`/${base64Encode(row.dir)}/session/${row.id}`}
                class="rounded-lg border border-border-weaker-base px-2.5 py-2 flex items-start gap-2 min-w-0 hover:bg-surface-raised-base-hover transition-colors"
                onClick={() => {
                  if (row.kind !== "ready" && row.kind !== "error") return
                  notification.session.markViewed(row.id)
                }}
              >
                <div class="w-4 pt-0.5 shrink-0 flex items-center justify-center">
                  <Marker kind={row.kind} />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-2">
                    <div class="text-13-medium text-text-strong truncate">{row.title}</div>
                    <Show when={row.count}>
                      <div class="rounded-full bg-surface-raised-base px-1.5 py-0.5 text-11-medium text-text-base">
                        {row.count}
                      </div>
                    </Show>
                  </div>
                  <div class="text-12-regular text-text-base truncate">{row.note}</div>
                  <div class="text-11-regular text-text-weak truncate">{row.space}</div>
                </div>
              </A>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}

function Marker(props: { kind: Kind }) {
  return (
    <Show when={props.kind !== "running"} fallback={<Spinner class="size-[13px]" />}>
      <Show when={props.kind === "attention"}>
        <Icon name="warning" size="small" class="text-icon-warning-base" />
      </Show>
      <Show when={props.kind === "ready"}>
        <div class="size-1.5 rounded-full bg-text-interactive-base" />
      </Show>
      <Show when={props.kind === "error"}>
        <div class="size-1.5 rounded-full bg-text-diff-delete-base" />
      </Show>
    </Show>
  )
}
