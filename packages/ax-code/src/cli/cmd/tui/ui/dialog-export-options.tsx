import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { createStore } from "solid-js/store"
import { onMount, onCleanup, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { scheduleMicrotaskTask } from "@tui/util/microtask"

export type DialogExportOptionsProps = {
  defaultFilename: string
  defaultThinking: boolean
  defaultToolDetails: boolean
  defaultAssistantMetadata: boolean
  defaultOpenWithoutSaving: boolean
  onConfirm?: (options: {
    filename: string
    thinking: boolean
    toolDetails: boolean
    assistantMetadata: boolean
    openWithoutSaving: boolean
  }) => void
  onCancel?: () => void
}

export function DialogExportOptions(props: DialogExportOptionsProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  let textarea: TextareaRenderable
  const [store, setStore] = createStore({
    thinking: props.defaultThinking,
    toolDetails: props.defaultToolDetails,
    assistantMetadata: props.defaultAssistantMetadata,
    openWithoutSaving: props.defaultOpenWithoutSaving,
    active: "filename" as "filename" | "thinking" | "toolDetails" | "assistantMetadata" | "openWithoutSaving",
  })

  const confirm = () => {
    props.onConfirm?.({
      filename: textarea.plainText,
      thinking: store.thinking,
      toolDetails: store.toolDetails,
      assistantMetadata: store.assistantMetadata,
      openWithoutSaving: store.openWithoutSaving,
    })
    dialog.clear()
  }

  const renderOption = (input: {
    key: "thinking" | "toolDetails" | "assistantMetadata" | "openWithoutSaving"
    label: string
    checked: boolean
    isActive: boolean
  }) => (
    <box
      flexDirection="row"
      gap={2}
      paddingLeft={1}
      backgroundColor={input.isActive ? theme.backgroundElement : undefined}
      onMouseUp={() => setStore("active", input.key)}
    >
      <text fg={input.isActive ? theme.primary : theme.textMuted}>{input.checked ? "[x]" : "[ ]"}</text>
      <text fg={input.isActive ? theme.primary : theme.text}>{input.label}</text>
    </box>
  )

  useKeyboard((evt) => {
    if (evt.name === "return") {
      if (store.active === "filename") return
      evt.preventDefault()
      evt.stopPropagation()
      confirm()
    }
    if (evt.name === "tab") {
      const order: Array<"filename" | "thinking" | "toolDetails" | "assistantMetadata" | "openWithoutSaving"> = [
        "filename",
        "thinking",
        "toolDetails",
        "assistantMetadata",
        "openWithoutSaving",
      ]
      const currentIndex = order.indexOf(store.active)
      const nextIndex = (currentIndex + 1) % order.length
      setStore("active", order[nextIndex])
      evt.preventDefault()
    }
    if (evt.name === "space" || evt.name === " ") {
      if (store.active === "thinking") setStore("thinking", !store.thinking)
      if (store.active === "toolDetails") setStore("toolDetails", !store.toolDetails)
      if (store.active === "assistantMetadata") setStore("assistantMetadata", !store.assistantMetadata)
      if (store.active === "openWithoutSaving") setStore("openWithoutSaving", !store.openWithoutSaving)
      if (store.active !== "filename") evt.preventDefault()
    }
  })

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
          Export Options
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box gap={1}>
        <box>
          <text fg={theme.text}>Filename:</text>
        </box>
        <textarea
          onSubmit={confirm}
          height={3}
          keyBindings={[{ name: "return", action: "submit" }]}
          ref={(val: TextareaRenderable) => (textarea = val)}
          initialValue={props.defaultFilename}
          placeholder="Enter filename"
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
        />
      </box>
      <box flexDirection="column">
        {renderOption({
          key: "thinking",
          label: "Include thinking",
          checked: store.thinking,
          isActive: store.active === "thinking",
        })}
        {renderOption({
          key: "toolDetails",
          label: "Include tool details",
          checked: store.toolDetails,
          isActive: store.active === "toolDetails",
        })}
        {renderOption({
          key: "assistantMetadata",
          label: "Include assistant metadata",
          checked: store.assistantMetadata,
          isActive: store.active === "assistantMetadata",
        })}
        {renderOption({
          key: "openWithoutSaving",
          label: "Open without saving",
          checked: store.openWithoutSaving,
          isActive: store.active === "openWithoutSaving",
        })}
      </box>
      <Show when={store.active !== "filename"}>
        <text fg={theme.textMuted} paddingBottom={1}>
          Press <span style={{ fg: theme.text }}>space</span> to toggle, <span style={{ fg: theme.text }}>return</span>{" "}
          to confirm
        </text>
      </Show>
      <Show when={store.active === "filename"}>
        <text fg={theme.textMuted} paddingBottom={1}>
          Press <span style={{ fg: theme.text }}>return</span> to confirm, <span style={{ fg: theme.text }}>tab</span>{" "}
          for options
        </text>
      </Show>
    </box>
  )
}

DialogExportOptions.show = (
  dialog: DialogContext,
  defaultFilename: string,
  defaultThinking: boolean,
  defaultToolDetails: boolean,
  defaultAssistantMetadata: boolean,
  defaultOpenWithoutSaving: boolean,
) => {
  return new Promise<{
    filename: string
    thinking: boolean
    toolDetails: boolean
    assistantMetadata: boolean
    openWithoutSaving: boolean
  } | null>((resolve) => {
    dialog.replace(
      () => (
        <DialogExportOptions
          defaultFilename={defaultFilename}
          defaultThinking={defaultThinking}
          defaultToolDetails={defaultToolDetails}
          defaultAssistantMetadata={defaultAssistantMetadata}
          defaultOpenWithoutSaving={defaultOpenWithoutSaving}
          onConfirm={(options) => resolve(options)}
          onCancel={() => resolve(null)}
        />
      ),
      () => resolve(null),
    )
  })
}
