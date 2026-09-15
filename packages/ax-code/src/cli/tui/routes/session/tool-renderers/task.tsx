import { createEffect, createMemo, on } from "solid-js"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useLocal } from "@tui/context/local"
import { useKeybind } from "@tui/context/keybind"
import type { ToolPart } from "@ax-code/sdk/v2"
import type { TaskTool } from "@/tool/task"
import { Locale } from "@/util/locale"
import { Log } from "@/util/log"
import { InlineTool, type ToolProps } from "./primitives"

const log = Log.create({ service: "tui.session" })

export function Task(props: ToolProps<typeof TaskTool>) {
  const keybind = useKeybind()
  const { navigate } = useRoute()
  const local = useLocal()
  const sync = useSync()

  createEffect(
    on(
      () => props.metadata.sessionId,
      (id) => {
        if (id && !sync.data.message[id]?.length) {
          void sync.session.sync(id).catch((error) => {
            log.warn("task child session preview sync failed", { error, sessionID: id })
          })
        }
      },
    ),
  )

  const messages = createMemo(() => sync.data.message[props.metadata.sessionId ?? ""] ?? [])

  const tools = createMemo(() => {
    return messages().flatMap((msg) =>
      (sync.data.part[msg.id] ?? [])
        .filter((part): part is ToolPart => part.type === "tool")
        .map((part) => ({ tool: part.tool, state: part.state })),
    )
  })

  const current = createMemo(() => tools().findLast((x) => (x.state as any).title))

  const isRunning = createMemo(() => props.part.state.status === "running")

  const duration = createMemo(() => {
    const first = messages().find((x) => x.role === "user")?.time.created
    const assistant = messages().findLast((x) => x.role === "assistant")?.time.completed
    if (!first || !assistant) return 0
    return assistant - first
  })

  const content = createMemo(() => {
    if (!props.input.description) return ""
    let content = [`Task ${props.input.description}`]

    if (isRunning() && tools().length > 0) {
      // content[0] += ` · ${tools().length} toolcalls`
      const active = current()
      if (active) content.push(`↳ ${Locale.titlecase(active.tool)} ${(active.state as any).title}`)
      else content.push(`↳ ${tools().length} toolcalls`)
    }

    if (props.part.state.status === "completed") {
      content.push(`└ ${tools().length} toolcalls · ${Locale.duration(duration())}`)
    }

    return content.join("\n")
  })

  void keybind
  void local

  return (
    <InlineTool
      icon="│"
      spinner={isRunning()}
      complete={props.input.description}
      pending="Delegating..."
      part={props.part}
      onClick={() => {
        if (props.metadata.sessionId) {
          navigate({ type: "session", sessionID: props.metadata.sessionId })
        }
      }}
    >
      {content()}
    </InlineTool>
  )
}
