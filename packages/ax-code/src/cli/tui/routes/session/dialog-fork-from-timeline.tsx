import { useLanguage } from "@tui/context/language"
import { createMemo, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { Locale } from "@/util/locale"
import { useDialog } from "../../ui/dialog"
import { useToast } from "../../ui/toast"
import { Log } from "@/util/log"
import { createMessageFork } from "./message-fork"
import { timelineEntries } from "./timeline-messages"

const log = Log.create({ service: "tui.dialog-fork-from-timeline" })

export function DialogForkFromTimeline(props: { sessionID: string; onMove: (messageID: string) => void }) {
  const uiText = useLanguage().t

  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const forkMessage = createMessageFork({
    sessionID: () => props.sessionID,
    onError: (error, messageID) => {
      log.warn("timeline fork failed", { error, sessionID: props.sessionID, messageID })
      toast.show({ message: error instanceof Error ? error.message : "Failed to fork session", variant: "error" })
    },
  })

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const result = timelineEntries(sync.data.message[props.sessionID] ?? [], sync.data.part).map(
      ({ message, title }): DialogSelectOption<string> => ({
        title,
        value: message.id,
        footer: Locale.time(message.time.created),
        onSelect: (dialog) => forkMessage(message.id, dialog),
      }),
    )
    if (result.length === 0) {
      return [
        {
          title: uiText("ui.noForkTargetAvailable"),
          value: "empty",
          description: uiText("ui.noUserMessagesWithTextContentAreAvailableToForkFrom"),
          category: "Overview",
          disabled: true,
        },
      ]
    }
    return result
  })

  return (
    <DialogSelect
      onMove={(option) => {
        if (option.disabled) return
        props.onMove(option.value)
      }}
      title={uiText("ui.forkFromMessage")}
      options={options()}
    />
  )
}
