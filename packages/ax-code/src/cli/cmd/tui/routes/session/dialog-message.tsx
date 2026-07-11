import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { Clipboard } from "@tui/util/clipboard"
import { EventQuery } from "@/replay/query"
import { messageRoute } from "./route"
import { Log } from "@/util/log"
import { promptState } from "./messages"
import { useToast } from "@tui/ui/toast"

const log = Log.create({ service: "tui.dialog-message" })

export function DialogMessage(props: {
  messageID: string
  sessionID: string
  setPrompt?: (prompt: ReturnType<typeof promptState>) => void
}) {
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const message = createMemo(() => sync.data.message[props.sessionID]?.find((x) => x.id === props.messageID))
  const routeInfo = createMemo(() => {
    const msg = message()
    if (!msg || msg.role !== "user") return
    const sid = props.sessionID as Parameters<typeof EventQuery.bySessionWithTimestamp>[0]
    return messageRoute(msg, sync.data.part[msg.id] ?? [], EventQuery.bySessionWithTimestamp(sid), sync.data.agent)
  })
  const routeOptions = createMemo(() => {
    const info = routeInfo()
    if (!info) return []
    return [
      {
        title: info.title,
        value: "message.route",
        description: info.description,
        footer: info.footer,
        category: "Routing",
        onSelect: () => {},
      },
    ]
  })
  const route = useRoute()

  return (
    <DialogSelect
      title="Message Actions"
      options={[
        ...routeOptions(),
        {
          title: "Revert",
          value: "session.revert",
          description: "undo messages and file changes",
          onSelect: async (dialog) => {
            const msg = message()
            if (!msg) {
              toast.show({
                message: "Message is no longer available",
                variant: "warning",
              })
              dialog.clear()
              return
            }

            // The v2 SDK client resolves `{error}` instead of rejecting, so
            // the result must be checked — a failed revert would otherwise
            // fall through to the success path and clobber the prompt / close
            // the dialog while the server never reverted.
            const result = await sdk.client.session.revert({
              sessionID: props.sessionID,
              messageID: msg.id,
            })
            // The v2 client resolves { error } at runtime even though the generated
            // type doesn't surface it here; read it through a cast.
            const revertError = (result as { error?: unknown }).error
            if (revertError) {
              log.warn("dialog message revert failed", {
                error: revertError,
                sessionID: props.sessionID,
                messageID: msg.id,
              })
              toast.show({
                message: typeof revertError === "string" ? revertError : "Failed to revert message",
                variant: "error",
              })
              return
            }
            if (props.setPrompt) {
              props.setPrompt(promptState(sync.data.part[msg.id] ?? []))
            }
            dialog.clear()
          },
        },
        {
          title: "Copy",
          value: "message.copy",
          description: "message text to clipboard",
          category: "Actions",
          onSelect: async (dialog) => {
            const msg = message()
            if (!msg) {
              toast.show({
                message: "Message is no longer available",
                variant: "warning",
              })
              dialog.clear()
              return
            }

            const parts = sync.data.part[msg.id] ?? []
            const text = parts.reduce((agg, part) => {
              if (part.type === "text" && !part.synthetic && !part.ignored) {
                agg += part.text
              }
              return agg
            }, "")

            await Clipboard.copy(text)
              .then(() => {
                dialog.clear()
              })
              .catch((error) => {
                log.warn("dialog message copy failed", {
                  error,
                  sessionID: props.sessionID,
                  messageID: msg.id,
                })
                toast.show({
                  message: error instanceof Error ? error.message : "Failed to copy message",
                  variant: "error",
                })
              })
          },
        },
        {
          title: "Fork",
          value: "session.fork",
          description: "create a new session",
          category: "Actions",
          onSelect: async (dialog) => {
            const msg = message()
            if (!msg) {
              toast.show({
                message: "Message is no longer available",
                variant: "warning",
              })
              dialog.clear()
              return
            }

            await sdk.client.session
              .fork({
                sessionID: props.sessionID,
                messageID: msg.id,
              })
              .then((result) => {
                if (!result.data) {
                  const errorMessage = typeof result.error === "string" ? result.error : "Failed to fork session"
                  throw new Error(errorMessage)
                }
                route.navigate({
                  sessionID: result.data.id,
                  type: "session",
                  initialPrompt: promptState(sync.data.part[msg.id] ?? []),
                })
                dialog.clear()
              })
              .catch((error) => {
                log.warn("dialog message fork failed", {
                  error,
                  sessionID: props.sessionID,
                  messageID: msg.id,
                })
                toast.show({
                  message: error instanceof Error ? error.message : "Failed to fork session",
                  variant: "error",
                })
              })
          },
        },
      ]}
    />
  )
}
