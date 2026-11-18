import { onCleanup } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useRoute } from "@tui/context/route"
import type { DialogContext } from "@tui/ui/dialog"
import { promptState } from "./messages"

/** Forking may finish remotely after dismissal; only the initiating UI still owns its result. */
export function createMessageFork(input: {
  sessionID: () => string
  onError: (error: unknown, messageID: string) => void
}): (messageID: string, dialog: Pick<DialogContext, "stack" | "clear">) => Promise<void> {
  const sdk = useSDK()
  const sync = useSync()
  const route = useRoute()
  let alive = true
  onCleanup(() => {
    alive = false
  })
  const routeKey = (): string =>
    JSON.stringify([route.data.type, route.data.type === "session" ? route.data.sessionID : route.data.workspaceID])
  return async (messageID, dialog) => {
    const owner = dialog.stack.at(-1)
    if (!alive || !owner) return
    const sessionID = input.sessionID()
    const directory = sdk.directory
    const origin = routeKey()
    const isCurrent = (): boolean =>
      alive &&
      dialog.stack.at(-1) === owner &&
      input.sessionID() === sessionID &&
      sdk.directory === directory &&
      routeKey() === origin
    try {
      // The projection can be pruned while the request is pending.
      const initialPrompt = promptState(sync.data.part[messageID] ?? [])
      const result = await sdk.client.session.fork({ sessionID, messageID })
      if (!isCurrent()) return
      if (!result.data) {
        throw new Error(typeof result.error === "string" ? result.error : "Failed to fork session")
      }
      route.navigate({ type: "session", sessionID: result.data.id, initialPrompt })
      if (dialog.stack.at(-1) === owner) dialog.clear()
    } catch (error) {
      if (isCurrent()) input.onError(error, messageID)
    }
  }
}
