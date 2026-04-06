import { createMemo, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { Locale } from "@/util/locale"
import { useDialog } from "../../ui/dialog"

function statusLabel(status: string): string {
  switch (status) {
    case "completed": return "ok"
    case "error": return "ERR"
    case "running": return "running"
    case "pending": return "pending"
    default: return status
  }
}

function toolIcon(tool: string): string {
  switch (tool) {
    case "bash": return "$"
    case "read": return "\u2192"
    case "edit":
    case "write": return "\u270E"
    case "glob":
    case "grep":
    case "codesearch": return "\u2315"
    case "webfetch":
    case "websearch": return "\u2295"
    case "task": return "\u25C8"
    default: return "\u00B7"
  }
}

export function DialogActivity(props: { sessionID: string }) {
  const sync = useSync()
  const dialog = useDialog()

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const messages = sync.data.message[props.sessionID] ?? []
    const items: DialogSelectOption<string>[] = []
    for (const msg of messages) {
      const parts = sync.data.part[msg.id]
      if (!parts) continue
      for (const part of parts) {
        if (part.type !== "tool") continue
        const state = part.state as {
          status: string
          title?: string
          error?: string
          time?: { start: number; end?: number }
        }
        const title = state.title || (state.status === "error" && state.error ? `${part.tool}: ${state.error}` : part.tool)
        const duration = state.time?.end != null && state.time?.start != null
          ? `${((state.time.end - state.time.start) / 1000).toFixed(1)}s`
          : undefined
        items.push({
          title: `${toolIcon(part.tool)} ${title}`,
          value: part.id,
          description: `[${statusLabel(state.status)}]${duration ? ` ${duration}` : ""}`,
          footer: state.time?.start != null ? Locale.time(state.time.start) : undefined,
          category: part.tool,
        })
      }
    }
    return items.reverse()
  })

  return (
    <DialogSelect
      title="Activity History"
      options={options()}
      skipFilter={false}
    />
  )
}
