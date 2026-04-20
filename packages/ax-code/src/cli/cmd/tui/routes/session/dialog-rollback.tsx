import { createMemo, onMount } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { type DialogContext, useDialog } from "../../ui/dialog"
import { SessionRollback } from "./rollback"

export function DialogRollback(props: {
  sessionID: string
  messages: Parameters<typeof SessionRollback.load>[1]
  onSelect?: (point: SessionRollback.Point) => Promise<void> | void
}) {
  const dialog = useDialog()

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const detail = SessionRollback.load(props.sessionID as Parameters<typeof SessionRollback.load>[0], props.messages)
    if (detail.length === 0) {
      return [
        {
          title: "No rollback points recorded",
          value: "empty",
          description: "Run a session with step activity to capture rollback targets.",
          category: "Overview",
        },
      ]
    }

    return SessionRollback.entries(detail).map((item) => ({
      title: item.title,
      value: item.id,
      description: item.description,
      footer: item.footer,
      category: item.category,
      onSelect: (() => {
        const point = SessionRollback.find(detail, item.id)
        if (!point || !props.onSelect) return
        return async (dialog: DialogContext) => {
          try {
            await props.onSelect?.(point)
            dialog.clear()
          } catch {}
        }
      })(),
    }))
  })

  return <DialogSelect title="Rollback Points" options={options()} skipFilter={false} />
}
