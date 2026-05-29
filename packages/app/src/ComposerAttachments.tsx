import { createSignal, For, Show } from "solid-js"
import {
  createComposerAttachmentDraft,
  type AppComposerAttachment,
  type ComposerAttachmentKind,
} from "./runtime/actions"

export function ComposerAttachments(props: {
  attachments: AppComposerAttachment[]
  unsupported: boolean
  onChange: (attachments: AppComposerAttachment[]) => void
  onError: (message: string | undefined) => void
}) {
  const [kind, setKind] = createSignal<ComposerAttachmentKind>("file")
  const [path, setPath] = createSignal("")
  const [startLine, setStartLine] = createSignal("")
  const [endLine, setEndLine] = createSignal("")

  function addAttachment() {
    props.onError(undefined)
    try {
      const attachment = createComposerAttachmentDraft({
        kind: kind(),
        path: path(),
        startLine: readOptionalLineInput(startLine()),
        endLine: readOptionalLineInput(endLine()),
      })
      props.onChange([...props.attachments, attachment])
      setPath("")
      setStartLine("")
      setEndLine("")
    } catch (error) {
      props.onError(error instanceof Error ? error.message : String(error))
    }
  }

  function removeAttachment(id: string) {
    props.onChange(props.attachments.filter((item) => item.id !== id))
  }

  return (
    <>
      <div class="attachment-create" aria-label="Composer attachments">
        <select
          aria-label="Attachment type"
          onChange={(event) => setKind(event.currentTarget.value as ComposerAttachmentKind)}
          value={kind()}
        >
          <option value="file">File</option>
          <option value="context">Context</option>
          <option value="image">Image/PDF</option>
          <option value="directory">Directory</option>
        </select>
        <input
          aria-label="Attachment path"
          onInput={(event) => setPath(event.currentTarget.value)}
          placeholder="relative path, file URL, or data URL"
          value={path()}
        />
        <Show when={kind() === "context"}>
          <input
            aria-label="Attachment start line"
            min="1"
            onInput={(event) => setStartLine(event.currentTarget.value)}
            placeholder="start"
            type="number"
            value={startLine()}
          />
          <input
            aria-label="Attachment end line"
            min="1"
            onInput={(event) => setEndLine(event.currentTarget.value)}
            placeholder="end"
            type="number"
            value={endLine()}
          />
        </Show>
        <button disabled={path().trim().length === 0} onClick={addAttachment} type="button">
          Add
        </button>
      </div>
      <Show when={props.attachments.length > 0}>
        <div class="attachment-list" aria-label="Attached context">
          <For each={props.attachments}>
            {(attachment) => (
              <span class="attachment-chip">
                <span>{attachmentLabel(attachment)}</span>
                <button
                  aria-label={`Remove attachment ${attachment.filename ?? attachment.path}`}
                  onClick={() => removeAttachment(attachment.id)}
                  type="button"
                >
                  Remove
                </button>
              </span>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.unsupported}>
        <span class="composer-error">Shell mode does not support attachments.</span>
      </Show>
    </>
  )
}

function readOptionalLineInput(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const line = Number(trimmed)
  return Number.isFinite(line) ? line : Number.NaN
}

function attachmentLabel(attachment: AppComposerAttachment) {
  const range =
    attachment.kind === "context" && (attachment.startLine || attachment.endLine)
      ? `:${attachment.startLine ?? 1}${attachment.endLine ? `-${attachment.endLine}` : ""}`
      : ""
  return `${attachment.kind} · ${attachment.filename ?? attachment.path}${range}`
}
