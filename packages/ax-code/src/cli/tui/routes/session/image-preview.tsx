import type { FilePart, Message, Part } from "@ax-code/sdk/v2"
import { createEffect, createMemo, on, onCleanup, type Accessor } from "solid-js"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useLanguage } from "@tui/context/language"
import { useDialog } from "@tui/ui/dialog"
import { DialogImagePreview } from "@tui/ui/dialog-image-preview"
import { DialogSelect } from "@tui/ui/dialog-select"
import { imagePreviewLabel, isImagePreviewCandidate } from "@tui/ui/image-preview-source"

export function sessionImageAttachments(
  messages: readonly Pick<Message, "id" | "role">[],
  parts: Record<string, Part[] | undefined>,
) {
  return messages.flatMap((message) =>
    (parts[message.id] ?? []).flatMap((part): FilePart[] => {
      if (message.role === "user" && part.type === "file" && isImagePreviewCandidate(part)) return [part]
      if (part.type === "tool" && part.state.status === "completed") {
        return (part.state.attachments ?? []).filter(isImagePreviewCandidate)
      }
      return []
    }),
  )
}

export function useSessionImagePreview(input: {
  sessionID: Accessor<string>
  messages: Accessor<readonly Pick<Message, "id" | "role">[]>
  parts: Accessor<Record<string, Part[] | undefined>>
}) {
  const dialog = useDialog()
  const commands = useCommandDialog()
  const { t } = useLanguage()
  const files = createMemo(() =>
    sessionImageAttachments(input.messages(), input.parts()).filter((file) => file.sessionID === input.sessionID()),
  )
  let owned: (typeof dialog.stack)[number] | undefined
  let selected: FilePart | undefined
  const close = () => {
    if (owned && dialog.stack.at(-1) === owned) dialog.clear()
    owned = undefined
    selected = undefined
  }
  onCleanup(close)
  createEffect(on(input.sessionID, close, { defer: true }))
  createEffect(() => {
    const available = files()
    if (selected && !available.some((file) => file.id === selected!.id && file.url === selected!.url)) close()
  })
  const open = (file: FilePart) => {
    // A stale picker or a detached transcript row cannot preview another session.
    if (!files().some((candidate) => candidate.id === file.id && candidate.url === file.url)) return
    dialog.replace(() => <DialogImagePreview file={file} />)
    owned = dialog.stack.at(-1)
    selected = file
  }
  commands.register(() => [
    {
      title: `${t("ui.open")} PNG`,
      value: "session.images",
      category: t("common.session"),
      slash: { name: "images" },
      enabled: files().length > 0,
      onSelect: () => {
        const sessionID = input.sessionID()
        dialog.replace(() => (
          <DialogSelect
            title={`${t("ui.open")} PNG`}
            options={files().map((file) => ({
              title: imagePreviewLabel(file.filename ?? file.mime),
              value: file,
              description: imagePreviewLabel(file.mime),
              onSelect: () => {
                if (input.sessionID() === sessionID) open(file)
              },
            }))}
          />
        ))
        owned = dialog.stack.at(-1)
      },
    },
  ])
  return open
}
