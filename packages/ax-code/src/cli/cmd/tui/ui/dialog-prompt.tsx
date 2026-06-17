import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { onCleanup, onMount, Show, type JSX } from "solid-js"
import { scheduleMicrotaskTask } from "@tui/util/microtask"
import { useToast } from "./toast"
import { Log } from "@/util/log"

const log = Log.create({ service: "tui.dialog-prompt" })

export type DialogPromptProps = {
  title: string
  description?: () => JSX.Element
  placeholder?: string
  value?: string
  onConfirm?: (value: string) => unknown
  onCancel?: () => void
  /**
   * When false, the dialog is NOT auto-cleared after a successful confirm; the
   * `onConfirm` handler owns the dialog lifecycle (e.g. navigating to another
   * dialog or staying open to show an inline error). The dialog still stays
   * open when `onConfirm` rejects. Defaults to true. See #257.
   */
  autoClose?: boolean
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
        // Only auto-clear on success when the caller hasn't opted to manage the
        // dialog lifecycle itself. Awaiting `action` first ensures async confirm
        // handlers (e.g. provider auth) keep the prompt open until they resolve.
        if (props.autoClose !== false) dialog.clear()
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
        {/* OpenTUI 0.4.x tightened JSX child types to `string | Element`, so the
            optional `() => JSX.Element` description thunk must be invoked (and
            its `undefined` case guarded) rather than passed as a raw child. */}
        <Show when={props.description}>{(description) => description()()}</Show>
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
