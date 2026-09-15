import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { createMemo } from "solid-js"
import { useSDK } from "../context/sdk"

interface DialogSessionRenameProps {
  session: string
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (typeof error === "string" && error) return error
  if (error && typeof error === "object") {
    const candidate = error as { data?: { message?: string }; message?: string }
    return candidate.data?.message ?? candidate.message ?? fallback
  }
  return fallback
}

export function DialogSessionRename(props: DialogSessionRenameProps) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const session = createMemo(() => sync.session.get(props.session))

  return (
    <DialogPrompt
      title="Rename Session"
      value={session()?.title}
      onConfirm={async (value) => {
        const result = await sdk.client.session.update({
          sessionID: props.session,
          title: value,
        })
        if (result.error) {
          // Throw so DialogPrompt keeps the dialog open and surfaces a toast; the
          // v2 SDK resolves with { error } instead of rejecting on failure.
          throw new Error(errorMessage(result.error, "Failed to rename session"))
        }
        dialog.clear()
      }}
      onCancel={() => dialog.clear()}
    />
  )
}
