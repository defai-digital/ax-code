import { TextAttributes } from "@ax-code/opentui-core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { createStore } from "solid-js/store"
import { For } from "solid-js"
import { useKeyboard } from "@ax-code/opentui-solid"
import { useToast } from "./toast"
import { Locale } from "@/util/locale"
import { Log } from "@/util/log"

const log = Log.create({ service: "tui.dialog-confirm" })

export type DialogConfirmProps = {
  title: string
  message: string
  onConfirm?: () => void
  onCancel?: () => void
  label?: string
}

export type DialogConfirmResult = boolean | undefined

export function DialogConfirm(props: DialogConfirmProps) {
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()
  const [store, setStore] = createStore({
    active: "confirm" as "confirm" | "cancel",
  })

  function runDialogConfirmAction(action: () => unknown, failureMessage: string) {
    const fail = (error: unknown) => {
      log.warn("dialog confirm action failed", { error, title: props.title })
      toast.show({
        message: error instanceof Error ? error.message : failureMessage,
        variant: "error",
      })
    }
    // Invoke the handler synchronously: the callers run dialog.clear() right
    // after this, and clear() synchronously fires the item's onClose, so a
    // deferred onConfirm/onCancel would lose the DialogConfirm.show race and
    // the promise would always resolve undefined. Async follow-ups returned by
    // the handler still surface failures via toast.
    try {
      void Promise.resolve(action()).catch(fail)
    } catch (error) {
      fail(error)
    }
  }

  useKeyboard((evt) => {
    if (evt.name === "return") {
      if (store.active === "confirm") {
        runDialogConfirmAction(() => props.onConfirm?.(), `Failed to confirm ${props.title.toLowerCase()}`)
      }
      if (store.active === "cancel") {
        runDialogConfirmAction(() => props.onCancel?.(), `Failed to cancel ${props.title.toLowerCase()}`)
      }
      dialog.clear()
    }

    if (evt.name === "left" || evt.name === "right") {
      setStore("active", store.active === "confirm" ? "cancel" : "confirm")
    }
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
      <box paddingBottom={1}>
        <text fg={theme.textMuted}>{props.message}</text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <For each={["cancel", "confirm"] as const}>
          {(key) => (
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={key === store.active ? theme.primary : theme.backgroundElement}
              onMouseOver={() => setStore("active", key)}
              onMouseDown={() => setStore("active", key)}
              onMouseUp={() => {
                if (key === "confirm") {
                  runDialogConfirmAction(() => props.onConfirm?.(), `Failed to confirm ${props.title.toLowerCase()}`)
                }
                if (key === "cancel") {
                  runDialogConfirmAction(() => props.onCancel?.(), `Failed to cancel ${props.title.toLowerCase()}`)
                }
                dialog.clear()
              }}
            >
              <text fg={key === store.active ? theme.selectedListItemText : theme.textMuted}>
                {Locale.titlecase(key === "cancel" ? (props.label ?? key) : key)}
              </text>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}

DialogConfirm.show = (dialog: DialogContext, title: string, message: string, label?: string) => {
  return new Promise<DialogConfirmResult>((resolve) => {
    dialog.replace(
      () => (
        <DialogConfirm
          title={title}
          message={message}
          onConfirm={() => resolve(true)}
          onCancel={() => resolve(false)}
          label={label}
        />
      ),
      () => resolve(undefined),
    )
  })
}
