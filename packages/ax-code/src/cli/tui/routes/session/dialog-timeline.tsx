import { useLanguage } from "@tui/context/language"
import { createMemo, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { Locale } from "@/util/locale"
import { DialogMessage } from "./dialog-message"
import { useDialog } from "../../ui/dialog"
import type { PromptInfo } from "../../component/prompt/history"
import { routeNote } from "./route"
import { timelineEntries } from "./timeline-messages"

export function DialogTimeline(props: {
  sessionID: string
  onMove: (messageID: string) => void
  setPrompt?: (prompt: PromptInfo) => void
}) {
  const uiText = useLanguage().t

  const sync = useSync()
  const dialog = useDialog()

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const result = timelineEntries(sync.data.message[props.sessionID] ?? [], sync.data.part).map(
      ({ message, title }): DialogSelectOption<string> => ({
        title,
        value: message.id,
        description: routeNote(message, sync.data.part[message.id] ?? [], sync.data.agent) || undefined,
        footer: Locale.time(message.time.created),
        onSelect: (dialog) => {
          dialog.replace(() => (
            <DialogMessage messageID={message.id} sessionID={props.sessionID} setPrompt={props.setPrompt} />
          ))
        },
      }),
    )
    if (result.length === 0) {
      return [
        {
          title: uiText("ui.noTimelineMessageAvailable"),
          value: "empty",
          description: uiText("ui.noUserMessagesWithTextContentAreAvailableInThisSession"),
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
      title={uiText("ui.timeline")}
      options={options()}
    />
  )
}
