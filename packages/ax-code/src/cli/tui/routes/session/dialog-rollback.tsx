import { createMemo, onMount } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { type DialogContext, useDialog } from "../../ui/dialog"
import { SessionRollbackView } from "./rollback"
import { useToast } from "../../ui/toast"

export function DialogRollback(props: {
  sessionID: string
  messages: Parameters<typeof SessionRollbackView.load>[1]
  onSelect?: (point: SessionRollbackView.Point) => Promise<void> | void
}) {
  const dialog = useDialog()
  const toast = useToast()

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const detail = SessionRollbackView.load(
      props.sessionID as Parameters<typeof SessionRollbackView.load>[0],
      props.messages,
    )
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

    return SessionRollbackView.entries(detail).map((item) => ({
      title: item.title,
      value: item.id,
      description: item.description,
      footer: item.footer,
      category: item.category,
      onSelect: (() => {
        const point = SessionRollbackView.find(detail, item.id)
        if (!point || !props.onSelect) return
        return async (dialog: DialogContext) => {
          try {
            await props.onSelect?.(point)
            dialog.clear()
          } catch (error) {
            toast.show({
              message: error instanceof Error ? error.message : "Failed to rollback",
              variant: "error",
            })
          }
        }
      })(),
    }))
  })

  return <DialogSelect title="Rollback Points" options={options()} skipFilter={false} />
}
