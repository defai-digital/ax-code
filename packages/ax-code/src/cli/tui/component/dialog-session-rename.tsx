import { useLanguage } from "@tui/context/language"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { createMemo } from "solid-js"
import { useSDK } from "../context/sdk"
import { requestErrorMessage } from "../util/error-message"

interface DialogSessionRenameProps {
  session: string
}

export function DialogSessionRename(props: DialogSessionRenameProps) {
  const uiText = useLanguage().t

  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const session = createMemo(() => sync.session.get(props.session))

  return (
    <DialogPrompt
      title={uiText("ui.renameSession2")}
      value={session()?.title}
      onConfirm={async (value) => {
        const result = await sdk.client.session.update({
          sessionID: props.session,
          title: value,
        })
        if (result.error) {
          // Throw so DialogPrompt keeps the dialog open and surfaces a toast; the
          // v2 SDK resolves with { error } instead of rejecting on failure.
          throw new Error(requestErrorMessage(result.error, "Failed to rename session"))
        }
      }}
      onCancel={() => dialog.clear()}
    />
  )
}
