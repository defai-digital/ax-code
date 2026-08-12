import { TextareaRenderable, TextAttributes } from "@ax-code/opentui-core"
import { createSignal, onCleanup, onMount } from "solid-js"
import { useKeyboard } from "@ax-code/opentui-solid"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { scheduleMicrotaskTask } from "@tui/util/microtask"
import { focusRenderable } from "@tui/util/renderable-safety"
import { normalizeVendorBaseURL } from "@/provider/private-gpu/endpoint"
import type { PrivateGpuVendor } from "@/provider/private-gpu/presets"

export type DialogPrivateGpuConnectProps = {
  vendor: PrivateGpuVendor
  title?: string
  defaultBaseURL?: string
  onConfirm: (input: { baseURL: string; apiKey: string }) => unknown
}

export function DialogPrivateGpuConnect(props: DialogPrivateGpuConnectProps) {
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()
  const [active, setActive] = createSignal<"baseURL" | "apiKey">("baseURL")
  let baseURLInput: TextareaRenderable
  let apiKeyInput: TextareaRenderable
  const vendor = props.vendor
  const focusName = `${vendor.id}-connect`

  const focusActive = () => {
    const target = active() === "baseURL" ? baseURLInput : apiKeyInput
    focusRenderable(target, { name: `${focusName}-focus` })
    target?.gotoLineEnd()
  }

  const submit = () => {
    const rawURL = baseURLInput?.plainText ?? ""
    const apiKey = (apiKeyInput?.plainText ?? "").trim()
    if (!rawURL.trim()) {
      toast.show({ message: "Endpoint URL is required", variant: "error" })
      setActive("baseURL")
      focusActive()
      return
    }
    if (!apiKey) {
      toast.show({ message: `${vendor.tokenLabel} is required`, variant: "error" })
      setActive("apiKey")
      focusActive()
      return
    }
    let baseURL: string
    try {
      baseURL = normalizeVendorBaseURL(rawURL, vendor)
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : "Invalid endpoint",
        variant: "error",
      })
      setActive("baseURL")
      focusActive()
      return
    }
    void Promise.resolve(props.onConfirm({ baseURL, apiKey })).catch((error) => {
      toast.show({
        message: error instanceof Error ? error.message : `Failed to connect ${vendor.name}`,
        variant: "error",
      })
    })
  }

  useKeyboard((evt) => {
    if (evt.name === "tab") {
      evt.preventDefault()
      setActive((current) => (current === "baseURL" ? "apiKey" : "baseURL"))
      scheduleMicrotaskTask(focusActive, { name: `${focusName}-tab` })
      return
    }
    if (evt.name === "return") {
      evt.preventDefault()
      evt.stopPropagation()
      if (active() === "baseURL") {
        setActive("apiKey")
        scheduleMicrotaskTask(focusActive, { name: `${focusName}-next` })
        return
      }
      submit()
    }
  })

  onMount(() => {
    dialog.setSize("medium")
    const cancel = scheduleMicrotaskTask(focusActive, { name: `${focusName}-focus` })
    onCleanup(cancel)
  })

  const fieldLabel = (id: "baseURL" | "apiKey", label: string) => (
    <text attributes={TextAttributes.BOLD} fg={active() === id ? theme.primary : theme.text}>
      {label}
    </text>
  )

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title ?? `Connect ${vendor.name}`}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box gap={1}>
        <text fg={theme.textMuted}>{vendor.hint}</text>
        {fieldLabel("baseURL", `1. ${vendor.urlLabel}`)}
        <textarea
          height={3}
          keyBindings={[{ name: "return", action: "submit" }]}
          ref={(val: TextareaRenderable) => (baseURLInput = val)}
          initialValue={props.defaultBaseURL ?? vendor.defaultApi ?? ""}
          placeholder={vendor.urlPlaceholder}
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
        />
        {fieldLabel("apiKey", `2. ${vendor.tokenLabel}`)}
        <textarea
          height={3}
          keyBindings={[{ name: "return", action: "submit" }]}
          ref={(val: TextareaRenderable) => (apiKeyInput = val)}
          initialValue=""
          placeholder={vendor.tokenPlaceholder}
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
        />
      </box>
      <box flexDirection="row" gap={2}>
        <text fg={theme.text}>
          tab <span style={{ fg: theme.textMuted }}>next field</span>
        </text>
        <text fg={theme.text}>
          enter <span style={{ fg: theme.textMuted }}>connect</span>
        </text>
      </box>
    </box>
  )
}
