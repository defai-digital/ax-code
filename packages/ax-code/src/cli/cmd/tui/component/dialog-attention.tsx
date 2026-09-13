import { createMemo, onMount } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { knownAttentionRequests } from "../util/session-activity"

export function DialogAttention() {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const sdk = useSDK()
  const pending = createMemo(() => knownAttentionRequests(sync.data.permission, sync.data.question))
  const options = createMemo(() =>
    pending().map((request) => ({
      title: sync.session.get(request.sessionID)?.title ?? request.sessionID,
      value: request,
      description: request.kind === "approval" ? "Approval needed" : "Question pending",
    })),
  )
  onMount(() => dialog.setSize("large"))
  return (
    <DialogSelect
      title={sdk.sseConnected ? "Pending requests" : "Pending requests (cached)"}
      placeholder={sdk.sseConnected ? "Find a pending request" : "Connection unavailable; requests may be stale"}
      options={
        options().length
          ? options()
          : [
              {
                title: sync.data.status === "complete" ? "No known pending requests" : "Loading pending requests",
                value: undefined,
                disabled: true,
              },
            ]
      }
      onSelect={(option) => {
        // A different client may have answered while this row was selected.
        const selected = option.value
        if (!selected) return
        const request = pending().find((item) => item.kind === selected.kind && item.id === selected.id)
        const sessionID = request?.sessionID ?? selected.sessionID
        if (!sessionID) return
        route.navigate({ type: "session", sessionID })
        dialog.clear()
      }}
    />
  )
}
