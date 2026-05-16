import { createMemo, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { Locale } from "@/util/locale"
import { EventQuery } from "@/replay/query"
import { useDialog } from "../../ui/dialog"
import { activityItems as items, statusLabel } from "./activity"

export function DialogActivity(props: { sessionID: string }) {
  const sync = useSync()
  const dialog = useDialog()

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const messages = sync.data.message[props.sessionID] ?? []
    const parts = messages.flatMap((msg) => sync.data.part[msg.id] ?? [])
    const sid = props.sessionID as Parameters<typeof EventQuery.bySessionWithTimestamp>[0]
    const rows = EventQuery.bySessionWithTimestamp(sid)
    return items(parts, rows, sync.data.agent).map((item) => ({
      title: `${item.icon} ${item.label}`,
      value: item.id,
      description: `[${statusLabel(item.status)}]${item.description ? ` ${item.description}` : ""}`,
      footer: item.time != null ? Locale.time(item.time) : undefined,
      category: item.category,
    }))
  })

  return <DialogSelect title="Activity History" options={options()} skipFilter={false} />
}
