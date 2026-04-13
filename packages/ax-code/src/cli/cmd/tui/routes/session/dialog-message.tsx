import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { Clipboard } from "@tui/util/clipboard"
import type { PromptInfo } from "@tui/component/prompt/history"
import { strip } from "@tui/component/prompt/part"
import { EventQuery } from "@/replay/query"
import { messageRoute } from "./route"
import { Log } from "@/util/log"

const log = Log.create({ service: "tui.dialog-message" })

export function DialogMessage(props: {
  messageID: string
  sessionID: string
  setPrompt?: (prompt: PromptInfo) => void
}) {
  const sync = useSync()
  const sdk = useSDK()
  const message = createMemo(() => sync.data.message[props.sessionID]?.find((x) => x.id === props.messageID))
  const routeInfo = createMemo(() => {
    const msg = message()
    if (!msg || msg.role !== "user") return
    const sid = props.sessionID as Parameters<typeof EventQuery.bySessionWithTimestamp>[0]
    return messageRoute(msg, sync.data.part[msg.id] ?? [], EventQuery.bySessionWithTimestamp(sid), sync.data.agent)
  })
  const route = useRoute()

  return (
    <DialogSelect
      title="Message Actions"
      options={[
        ...(routeInfo()
          ? [{
              title: routeInfo()!.title,
              value: "message.route",
              description: routeInfo()!.description,
              footer: routeInfo()!.footer,
              category: "Routing",
              onSelect: () => {},
            }]
          : []),
        {
          title: "Revert",
          value: "session.revert",
          description: "undo messages and file changes",
          onSelect: (dialog) => {
            const msg = message()
            if (!msg) return

            sdk.client.session.revert({
              sessionID: props.sessionID,
              messageID: msg.id,
            })

            if (props.setPrompt) {
              const parts = sync.data.part[msg.id] ?? []
              const promptInfo = parts.reduce(
                (agg, part) => {
                  if (part.type === "text") {
                    if (!part.synthetic) agg.input += part.text
                  }
                  if (part.type === "file") agg.parts.push(strip(part))
                  return agg
                },
                { input: "", parts: [] as PromptInfo["parts"] },
              )
              props.setPrompt(promptInfo)
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
            if (!msg) return

            const parts = sync.data.part[msg.id] ?? []
            const text = parts.reduce((agg, part) => {
              if (part.type === "text" && !part.synthetic) {
                agg += part.text
              }
              return agg
            }, "")

            await Clipboard.copy(text)
            dialog.clear()
          },
        },
        {
          title: "Fork",
          value: "session.fork",
          description: "create a new session",
          category: "Actions",
          onSelect: async (dialog) => {
            const result = await sdk.client.session.fork({
              sessionID: props.sessionID,
              messageID: props.messageID,
            })
            if (!result.data) {
              log.warn("session fork failed", {
                sessionID: props.sessionID,
                messageID: props.messageID,
                error: result.error,
              })
              return
            }
            const initialPrompt = (() => {
              const msg = message()
              if (!msg) return undefined
              const parts = sync.data.part[msg.id] ?? []
              return parts.reduce(
                (agg, part) => {
                  if (part.type === "text") {
                    if (!part.synthetic) agg.input += part.text
                  }
                  if (part.type === "file") agg.parts.push(part)
                  return agg
                },
                { input: "", parts: [] as PromptInfo["parts"] },
              )
            })()
            route.navigate({
              sessionID: result.data.id,
              type: "session",
              initialPrompt,
            })
            dialog.clear()
          },
        },
      ]}
    />
  )
}
