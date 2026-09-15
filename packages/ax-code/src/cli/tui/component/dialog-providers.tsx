import { useLanguage } from "@tui/context/language"
import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { DialogModel } from "./dialog-model"
import { DialogProvider, setProviderDisabled } from "./dialog-provider"
import { disabledProviderIDs } from "./provider-list-view-model"

const CONNECT_NEW_VALUE = "__connect_new__"

/**
 * Management view over providers that are already set up — connected ones from
 * `sync.data.provider` plus disabled ones from config `disabled_providers`
 * (which the server filters out of every provider list, so config is the only
 * place they still show up). Each row toggles between enable/disable or
 * disconnect; "Connect new provider" hands off to the full /connect flow.
 */
export function DialogProviders() {
  const uiText = useLanguage().t

  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()

  const connected = createMemo(() => sync.data.provider)
  const disabled = createMemo(() =>
    disabledProviderIDs(
      sync.data.config,
      connected().map((p) => p.id),
    ),
  )

  async function disconnect(providerID: string, providerName: string, reenableFirst: boolean) {
    // A disabled provider must leave disabled_providers when its credential is
    // deleted, otherwise it lingers in the Disabled list with nothing to use.
    if (reenableFirst)
      await setProviderDisabled({ sdk, sync, toast, dialog, providerID, providerName, disabled: false })
    const removed = await sdk.client.auth.remove({ providerID })
    if (removed.error) {
      toast.show({ variant: "error", message: JSON.stringify(removed.error) })
      return
    }
    await sdk.client.instance.dispose()
    await sync.bootstrap()
    toast.show({ variant: "success", message: `Disconnected ${providerName}` })
    dialog.clear()
  }

  async function manage(providerID: string, providerName: string, isDisabled: boolean) {
    type Action = "use" | "toggle" | "disconnect" | null
    const action = await new Promise<Action>((resolve) => {
      dialog.replace(
        () => (
          <DialogSelect
            title={`${providerName} — ${isDisabled ? "disabled" : "connected"}`}
            options={
              isDisabled
                ? [
                    {
                      title: uiText("provider.enable"),
                      value: "toggle" as const,
                      description: uiText("provider.enableHint"),
                    },
                    {
                      title: uiText("common.disconnect"),
                      value: "disconnect" as const,
                      description: uiText("provider.removeCredentials"),
                    },
                  ]
                : [
                    {
                      title: uiText("provider.selectModel"),
                      value: "use" as const,
                      description: uiText("ui.switchToAModelFromThisProvider"),
                    },
                    {
                      title: uiText("provider.disable"),
                      value: "toggle" as const,
                      description: uiText("provider.keepCredentials"),
                    },
                    {
                      title: uiText("common.disconnect"),
                      value: "disconnect" as const,
                      description: uiText("provider.removeCredentials"),
                    },
                  ]
            }
            onSelect={(option) => resolve(option.value as Action)}
          />
        ),
        () => resolve(null),
      )
    })
    if (action === null) return
    if (action === "use") {
      dialog.replace(() => <DialogModel providerID={providerID} />)
      return
    }
    if (action === "toggle") {
      await setProviderDisabled({ sdk, sync, toast, dialog, providerID, providerName, disabled: !isDisabled })
      return
    }
    await disconnect(providerID, providerName, isDisabled)
  }

  const options = createMemo(() => [
    ...connected().map((provider) => ({
      title: provider.name,
      value: provider.id,
      description: uiText("ui.connected"),
      onSelect: () => manage(provider.id, provider.name, false),
    })),
    ...disabled().map((providerID) => ({
      title: providerID,
      value: providerID,
      description: uiText("ensemble.disabled"),
      onSelect: () => manage(providerID, providerID, true),
    })),
    {
      title: uiText("ui.connectNewProvider"),
      value: CONNECT_NEW_VALUE,
      description: uiText("ui.addAnApiKeyOauthLoginCliOrLocalRuntime"),
      onSelect: () => dialog.replace(() => <DialogProvider />),
    },
  ])

  return <DialogSelect title={uiText("ui.providers")} options={options()} />
}
