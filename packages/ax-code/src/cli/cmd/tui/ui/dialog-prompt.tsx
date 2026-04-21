import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { onCleanup, onMount, type JSX } from "solid-js"
import { scheduleMicrotaskTask } from "@tui/util/microtask"
import { useToast } from "./toast"
import { Log } from "@/util/log"

const log = Log.create({ service: "tui.dialog-prompt" })

export type DialogPromptProps = {
  title: string
  description?: () => JSX.Element
  placeholder?: string
  value?: string
  onConfirm?: (value: string) => void
  onCancel?: () => void
}

export function DialogPrompt(props: DialogPromptProps) {
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()
  let textarea: TextareaRenderable

  function runDialogPromptAction(action: () => unknown, failureMessage: string) {
    void Promise.resolve()
      .then(action)
      .then(() => {
        dialog.clear()
      })
      .catch((error) => {
        log.warn("dialog prompt confirm failed", { error, title: props.title })
        toast.show({
          message: error instanceof Error ? error.message : failureMessage,
          variant: "error",
        })
      })
  }

  onMount(() => {
    dialog.setSize("medium")
    const cancel = scheduleMicrotaskTask(() => {
      if (!textarea || textarea.isDestroyed) return
      textarea.focus()
    })
    onCleanup(cancel)
    textarea.gotoLineEnd()
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box gap={1}>
        {props.description}
        <textarea
          onSubmit={() => {
            runDialogPromptAction(
              () => props.onConfirm?.(textarea.plainText),
              `Failed to confirm ${props.title.toLowerCase()}`,
            )
          }}
          height={3}
          keyBindings={[{ name: "return", action: "submit" }]}
          ref={(val: TextareaRenderable) => (textarea = val)}
          initialValue={props.value}
          placeholder={props.placeholder ?? "Enter text"}
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
        />
      </box>
      <box paddingBottom={1} gap={1} flexDirection="row">
        <text fg={theme.text}>
          enter <span style={{ fg: theme.textMuted }}>submit</span>
        </text>
      </box>
    </box>
  )
}

DialogPrompt.show = (dialog: DialogContext, title: string, options?: Omit<DialogPromptProps, "title">) => {
  return new Promise<string | null>((resolve) => {
    dialog.replace(
      () => (
        <DialogPrompt title={title} {...options} onConfirm={(value) => resolve(value)} onCancel={() => resolve(null)} />
      ),
      () => resolve(null),
    )
  })
}
