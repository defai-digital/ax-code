import { useDialog } from "@ax-code/ui/context/dialog"
import { getFilename } from "@ax-code/util/path"
import { createResource, createMemo, For, Show } from "solid-js"
import { DialogProjectContext } from "@/components/dialog-project-context"
import { type ProjectContextInfo, useProjectContextRequest } from "@/components/project-context-data"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { useSync } from "@/context/sync"
import { useSessionKey } from "@/pages/session/session-layout"
import type { SessionComposerState } from "./session-composer-state"

type Tone = "base" | "success" | "warning" | "critical"
type Item = {
  label: string
  value: string
  tone?: Tone
  action?: () => void
}

const idle = { type: "idle" as const }

const trim = (value: string) => value.replace(/[\\/]+$/, "")

const rel = (root: string, dir: string) => {
  const base = trim(root)
  const next = trim(dir)
  if (base === next) return ""
  const unix = `${base}/`
  const win = `${base}\\`
  if (next.startsWith(unix)) return next.slice(unix.length)
  if (next.startsWith(win)) return next.slice(win.length)
  return dir
}

export function SessionStatusLine(props: {
  state: SessionComposerState
  followup?: {
    count: number
    paused?: boolean
    failed?: boolean
    sending?: boolean
  }
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const permission = usePermission()
  const sdk = useSDK()
  const server = useServer()
  const sync = useSync()
  const route = useSessionKey()
  const request = useProjectContextRequest()

  const [context] = createResource(
    () => `${server.key}:${sdk.directory}`,
    () => request<ProjectContextInfo>("/context"),
  )

  const info = createMemo(() => (route.params.id ? sync.session.get(route.params.id) : undefined))
  const diffs = createMemo(() => (route.params.id ? (sync.data.session_diff[route.params.id] ?? []) : []))
  const count = createMemo(() => Math.max(info()?.summary?.files ?? 0, diffs().length))
  const root = createMemo(() => sync.project?.worktree ?? sdk.directory)
  const room = createMemo(() => sync.project?.name || getFilename(root()) || root())
  const dir = createMemo(() => rel(root(), sdk.directory))
  const auto = createMemo(() => {
    const id = route.params.id
    if (id) return permission.isAutoAccepting(id, sdk.directory)
    return permission.isAutoAcceptingDirectory(sdk.directory)
  })
  const status = createMemo(() => sync.data.session_status[route.params.id ?? ""] ?? idle)

  const mode = createMemo(() => {
    const current = status()
    if (props.state.permissionRequest()) {
      return {
        value: language.t("session.status.mode.permission"),
        tone: "warning" as const,
      }
    }
    if (props.state.questionRequest()) {
      return {
        value: language.t("session.status.mode.question"),
        tone: "warning" as const,
      }
    }
    if (current.type === "retry") {
      return {
        value: language.t("session.status.mode.retry", { attempt: current.attempt }),
        tone: "warning" as const,
      }
    }
    if (current.type === "busy") {
      return {
        value: language.t("session.status.mode.busy"),
        tone: "success" as const,
      }
    }
    return {
      value: language.t("session.status.mode.ready"),
      tone: "base" as const,
    }
  })

  const serverState = createMemo(() => {
    const health = server.healthy()
    if (health === true) {
      return {
        value: language.t("session.status.server.ready"),
        tone: "success" as const,
      }
    }
    if (health === false) {
      return {
        value: language.t("session.status.server.error"),
        tone: "critical" as const,
      }
    }
    return {
      value: language.t("session.status.server.checking"),
      tone: "base" as const,
    }
  })

  const review = createMemo(() => {
    const total = count()
    if (!total) return language.t("session.status.review.none")
    return language.t(total === 1 ? "session.status.review.one" : "session.status.review.other", { count: total })
  })

  const rules = (value: number) => {
    if (!value) return language.t("session.status.context.rules.none")
    return language.t(value === 1 ? "session.status.context.rules.one" : "session.status.context.rules.other", {
      count: value,
    })
  }

  const contextState = createMemo(() => {
    const data = context()
    if (data) {
      return {
        value: `${rules(data.instructions.length)} • ${language.t(
          data.memory?.exists ? "session.status.context.memory.ready" : "session.status.context.memory.empty",
        )}`,
        tone: "base" as const,
      }
    }
    if (context.error) {
      return {
        value: language.t("session.status.context.unavailable"),
        tone: "warning" as const,
      }
    }
    return {
      value: language.t("session.status.context.loading"),
      tone: "base" as const,
    }
  })

  const approval = createMemo(() => {
    const total = props.state.permissionRequest() ? 1 : 0
    if (total > 0) {
      return language.t(total === 1 ? "session.status.approval.pending.one" : "session.status.approval.pending.other", {
        count: total,
      })
    }
    if (auto()) return language.t("session.status.approval.auto")
    return language.t("session.status.approval.ask")
  })
  const followup = createMemo(() => {
    const data = props.followup
    if (!data || data.count <= 0) return

    const queued = language.t(
      data.count === 1 ? "session.status.followup.queued.one" : "session.status.followup.queued.other",
      { count: data.count },
    )

    if (data.failed) {
      return {
        value: `${language.t("session.status.followup.failed")} • ${queued}`,
        tone: "warning" as const,
      }
    }

    if (data.paused) {
      return {
        value: `${language.t("session.status.followup.paused")} • ${queued}`,
        tone: "warning" as const,
      }
    }

    if (data.sending) {
      return {
        value: `${language.t("session.status.followup.sending")} • ${queued}`,
        tone: "success" as const,
      }
    }

    return {
      value: queued,
      tone: "base" as const,
    }
  })

  const list = createMemo(() => {
    const items: Item[] = [
      {
        label: language.t("session.status.mode.label"),
        value: mode().value,
        tone: mode().tone,
      },
      {
        label: language.t("session.status.workspace"),
        value: room(),
      },
    ]

    if (dir()) {
      items.push({
        label: language.t("session.status.directory"),
        value: dir(),
      })
    }

    items.push(
      {
        label: language.t("session.status.server"),
        value: `${server.name} • ${serverState().value}`,
        tone: serverState().tone,
      },
      {
        label: language.t("session.status.review"),
        value: review(),
      },
      {
        label: language.t("session.status.approval"),
        value: approval(),
        tone: props.state.permissionRequest() ? "warning" : auto() ? "success" : "base",
      },
    )

    if (followup()) {
      items.push({
        label: language.t("session.status.followup"),
        value: followup()!.value,
        tone: followup()!.tone,
      })
    }

    items.push({
      label: language.t("session.status.context"),
      value: contextState().value,
      tone: contextState().tone,
      action: () => dialog.show(() => <DialogProjectContext />),
    })

    return items
  })

  return (
    <div class="mb-2 flex flex-wrap items-center gap-2">
      <For each={list()}>
        {(item) => (
          <Chip
            label={item.label}
            value={item.value}
            tone={item.tone}
            title={`${item.label}: ${item.value}`}
            onClick={item.action}
          />
        )}
      </For>
    </div>
  )
}

function Chip(props: { label: string; value: string; title?: string; tone?: Tone; onClick?: () => void }) {
  const dot = () => {
    switch (props.tone) {
      case "success":
        return "bg-icon-success-base"
      case "warning":
        return "bg-icon-warning-base"
      case "critical":
        return "bg-icon-critical-base"
      default:
        return "bg-border-weak-base"
    }
  }

  const body = (
    <>
      <Show when={props.tone}>
        <div
          classList={{
            "size-1.5 rounded-full shrink-0": true,
            [dot()]: true,
          }}
        />
      </Show>
      <span class="text-text-weak shrink-0">{props.label}</span>
      <span class="text-text-strong min-w-0 truncate">{props.value}</span>
    </>
  )

  return props.onClick ? (
    <button
      type="button"
      title={props.title}
      class="max-w-full inline-flex items-center gap-1.5 rounded-full border border-border-weaker-base bg-background-base/80 px-2.5 py-1 text-11-medium backdrop-blur-sm transition-colors hover:bg-surface-base"
      onClick={props.onClick}
    >
      {body}
    </button>
  ) : (
    <div
      title={props.title}
      class="max-w-full inline-flex items-center gap-1.5 rounded-full border border-border-weaker-base bg-background-base/80 px-2.5 py-1 text-11-medium backdrop-blur-sm"
    >
      {body}
    </div>
  )
}
