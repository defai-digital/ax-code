import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { DialogModel } from "./dialog-model"
import { DialogProvider, setProviderDisabled } from "./dialog-provider"

const CONNECT_NEW_VALUE = "__connect_new__"

/**
 * Management view over providers that are already set up — connected ones from
 * `sync.data.provider` plus disabled ones from config `disabled_providers`
 * (which the server filters out of every provider list, so config is the only
 * place they still show up). Each row toggles between enable/disable or
 * disconnect; "Connect new provider" hands off to the full /connect flow.
 */
export function DialogProviders() {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()

  const connected = createMemo(() => sync.data.provider)
  const disabled = createMemo(() =>
    (sync.data.config?.disabled_providers ?? []).filter((id) => !connected().some((p) => p.id === id)),
  )

  async function disconnect(providerID: string, providerName: string, reenableFirst: boolean) {
    // A disabled provider must leave disabled_providers when its credential is
    // deleted, otherwise it lingers in the Disabled list with nothing to use.
    if (reenableFirst) await setProviderDisabled({ sdk, sync, toast, dialog, providerID, providerName, disabled: false })
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
                      title: "Enable",
                      value: "toggle" as const,
                      description: "Turn back on — uses saved credentials",
                    },
                    {
                      title: "Disconnect",
                      value: "disconnect" as const,
                      description: "Remove saved credentials",
                    },
                  ]
                : [
                    {
                      title: "Select a model",
                      value: "use" as const,
                      description: "Switch to a model from this provider",
                    },
                    {
                      title: "Disable",
                      value: "toggle" as const,
                      description: "Turn off temporarily — keeps credentials",
                    },
                    {
                      title: "Disconnect",
                      value: "disconnect" as const,
                      description: "Remove saved credentials",
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
      description: "Connected",
      onSelect: () => manage(provider.id, provider.name, false),
    })),
    ...disabled().map((providerID) => ({
      title: providerID,
      value: providerID,
      description: "Disabled",
      onSelect: () => manage(providerID, providerID, true),
    })),
    {
      title: "Connect new provider",
      value: CONNECT_NEW_VALUE,
      description: "Add an API key, OAuth login, CLI, or local runtime",
      onSelect: () => dialog.replace(() => <DialogProvider />),
    },
  ])

  return <DialogSelect title="Providers" options={options()} />
}
