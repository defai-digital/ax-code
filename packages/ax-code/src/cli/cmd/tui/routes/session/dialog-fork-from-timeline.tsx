import { createMemo, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import type { TextPart } from "@ax-code/sdk/v2"
import { Locale } from "@/util/locale"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useDialog } from "../../ui/dialog"
import { useToast } from "../../ui/toast"
import { Log } from "@/util/log"
import { promptState } from "./messages"

const log = Log.create({ service: "tui.dialog-fork-from-timeline" })

export function DialogForkFromTimeline(props: { sessionID: string; onMove: (messageID: string) => void }) {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const route = useRoute()
  const toast = useToast()

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const messages = sync.data.message[props.sessionID] ?? []
    const result = [] as DialogSelectOption<string>[]
    for (const message of messages) {
      if (message.role !== "user") continue
      const part = (sync.data.part[message.id] ?? []).find(
        (x) => x.type === "text" && !x.synthetic && !x.ignored,
      ) as TextPart
      if (!part) continue
      result.push({
        title: part.text.replace(/\n/g, " "),
        value: message.id,
        footer: Locale.time(message.time.created),
        onSelect: async (dialog) => {
          await sdk.client.session
            .fork({
              sessionID: props.sessionID,
              messageID: message.id,
            })
            .then((forked) => {
              if (!forked.data) {
                const errorMessage = typeof forked.error === "string" ? forked.error : "Failed to fork session"
                throw new Error(errorMessage)
              }
              route.navigate({
                sessionID: forked.data.id,
                type: "session",
                initialPrompt: promptState(sync.data.part[message.id] ?? []),
              })
              dialog.clear()
            })
            .catch((error) => {
              log.warn("timeline fork failed", {
                error,
                sessionID: props.sessionID,
                messageID: message.id,
              })
              toast.show({
                message: error instanceof Error ? error.message : "Failed to fork session",
                variant: "error",
              })
            })
        },
      })
    }
    result.reverse()
    return result
  })

  return <DialogSelect onMove={(option) => props.onMove(option.value)} title="Fork from message" options={options()} />
}
