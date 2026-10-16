import { TextAttributes } from "ax-tui"
import { useKeyboard } from "ax-tui/solid"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { useLanguage } from "@tui/context/language"
import { useExit } from "@tui/context/exit"
import { useSDK } from "@tui/context/sdk"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { unknownErrorMessage } from "@tui/util/error-message"
import { interactiveUpgrade } from "../update-session"
import {
  primaryUpdateAction,
  updateStateFromAvailable,
  updateStateFromCheck,
  updateStateFromUpgrade,
  type UpdateDialogState,
} from "../update-dialog-view-model"
import { Spinner } from "./spinner"

// Manual "Check for updates" and the automatic update notification share this
// dialog. With `available` set the check is skipped and the dialog opens on
// the offer; `onSkip` is the automatic notification's "remember this version".
export function DialogUpdate(props: { available?: { current: string; latest: string }; onSkip?: () => void }) {
  const { t } = useLanguage()
  const sdk = useSDK()
  const exit = useExit()
  const dialog = useDialog()
  const { theme } = useTheme()
  const [state, setState] = createSignal<UpdateDialogState>(
    props.available ? updateStateFromAvailable(props.available.current, props.available.latest) : { type: "checking" },
  )
  let disposed = false
  onCleanup(() => {
    disposed = true
  })

  const check = async () => {
    setState({ type: "checking" })
    const result = await sdk.client.global.upgrade2.check().catch((error: unknown) => ({
      data: undefined,
      error,
    }))
    if (disposed) return
    if (!result.data) {
      setState({ type: "check-failed", message: unknownErrorMessage(result.error) })
      return
    }
    setState(updateStateFromCheck(result.data))
  }

  const install = async (latest: string) => {
    setState({ type: "installing", version: latest })
    interactiveUpgrade.version = latest
    const response = await sdk.client.global.upgrade({ target: latest }).catch((error: unknown) => ({
      data: undefined,
      error,
    }))
    const next = updateStateFromUpgrade(latest, response, unknownErrorMessage)
    if (next.type !== "installed") interactiveUpgrade.version = undefined
    if (disposed) return
    setState(next)
  }

  const act = () => {
    const current = state()
    switch (primaryUpdateAction(current)) {
      case "install":
        if (current.type === "available") void install(current.latest)
        return
      case "retry-check":
        void check()
        return
      case "retry-install":
        if (current.type === "install-failed") void install(current.latest)
        return
      case "exit":
        exit()
        return
    }
  }

  const skip = () => {
    if (state().type === "available") props.onSkip?.()
    dialog.clear()
  }

  onMount(() => {
    if (!props.available) void check()
  })

  useKeyboard((evt) => {
    if (evt.name !== "return") return
    evt.preventDefault()
    evt.stopPropagation()
    act()
  })

  const primaryLabel = () => {
    switch (primaryUpdateAction(state())) {
      case "install":
        return t("ui.update.action.install")
      case "retry-check":
      case "retry-install":
        return t("ui.update.action.retry")
      case "exit":
        return t("ui.update.action.exit")
      default:
        return undefined
    }
  }
  const dismissLabel = () => {
    const type = state().type
    if (type === "installing" || type === "checking") return undefined
    return type === "available" || type === "installed" ? t("ui.update.action.later") : t("ui.ok")
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {t("ui.update.title")}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box paddingBottom={1} gap={1}>
        {(() => {
          const current = state()
          switch (current.type) {
            case "checking":
              return <Spinner>{t("ui.update.checking")}</Spinner>
            case "installing":
              return <Spinner>{t("ui.update.installing", { version: current.version })}</Spinner>
            case "current":
              return <text fg={theme.textMuted}>{t("ui.update.current", { version: current.version })}</text>
            case "available":
              return (
                <text fg={theme.text} wrapMode="word">
                  {t("ui.update.available", { latest: current.latest, current: current.current })}
                </text>
              )
            case "installed":
              return (
                <box gap={1}>
                  <text fg={theme.success} wrapMode="word">
                    {t("ui.update.installed", { version: current.version })}
                  </text>
                  <Show when={current.warnings.length > 0}>
                    <text fg={theme.warning} wrapMode="word">
                      {current.warnings.join("\n")}
                    </text>
                  </Show>
                </box>
              )
            case "check-failed":
              return (
                <text fg={theme.error} wrapMode="word">
                  {t("ui.update.checkFailed", { message: current.message })}
                </text>
              )
            case "install-failed":
              return (
                <text fg={theme.error} wrapMode="word">
                  {t("ui.updateFailed")}: {current.message}
                </text>
              )
          }
        })()}
      </box>
      <box flexDirection="row" justifyContent="flex-end" gap={2} paddingBottom={1}>
        <Show when={dismissLabel()}>
          {(label) => (
            <box paddingLeft={3} paddingRight={3} onMouseUp={skip}>
              <text fg={theme.textMuted}>{label()}</text>
            </box>
          )}
        </Show>
        <Show when={primaryLabel()}>
          {(label) => (
            <box paddingLeft={3} paddingRight={3} backgroundColor={theme.primary} onMouseUp={act}>
              <text fg={theme.selectedListItemText}>{label()}</text>
            </box>
          )}
        </Show>
      </box>
    </box>
  )
}
