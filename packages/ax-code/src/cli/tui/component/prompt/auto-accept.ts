import { createEffect, createSignal, onCleanup } from "solid-js"
import z from "zod"
import { useSDK } from "../../context/sdk"
import { useLanguage } from "../../context/language"
import { useToast } from "../../ui/toast"
import { useCommandDialog, type CommandOption } from "../dialog-command"
import { directoryRequestHeaders } from "../../util/request-headers"
import { urlAllowlistServerRoute } from "../../util/server-url"
import { responseErrorMessage } from "../../util/error-message"

const Status = z.object({ enabled: z.boolean(), managedDisabled: z.boolean(), directory: z.string() })
type Sdk = Pick<ReturnType<typeof useSDK>, "url" | "directory" | "fetch">

/** Raw authenticated route until the separately generated SDK adds these methods. */
export async function requestAutoAccept(sdk: Sdk, enabled?: boolean) {
  const response = await sdk.fetch(urlAllowlistServerRoute(sdk.url, "/permission/auto-accept"), {
    method: enabled === undefined ? "GET" : "PUT",
    headers: directoryRequestHeaders({ directory: sdk.directory, contentType: "application/json" }),
    ...(enabled === undefined ? {} : { body: JSON.stringify({ enabled }) }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(await responseErrorMessage(response))
  return Status.parse(await response.json())
}

export function autoAcceptCommand(title: string, toggle: () => Promise<void>): CommandOption {
  return {
    title,
    value: "project.auto_accept",
    category: "Project",
    keybind: "project_auto_accept",
    slash: { name: "auto-accept" },
    onSelect: (dialog) => {
      dialog.clear()
      void toggle()
    },
  }
}

export function useProjectAutoAccept(sessionID: () => string | undefined) {
  const sdk = useSDK()
  const { t } = useLanguage()
  const toast = useToast()
  const command = useCommandDialog()
  const [status, setStatus] = createSignal<z.infer<typeof Status>>()
  const [busy, setBusy] = createSignal(false)
  let generation = 0
  let disposed = false
  onCleanup(() => {
    disposed = true
  })
  createEffect(() => {
    const directory = sdk.directory
    const connected = sdk.sseConnected
    const current = ++generation
    setStatus(undefined)
    if (!connected) return
    void requestAutoAccept({ ...sdk, directory })
      .then((next) => {
        if (!disposed && current === generation) setStatus(next)
      })
      .catch(() => {
        // An unavailable backend never leaves a stale enabled indicator.
        if (!disposed && current === generation) setStatus(undefined)
      })
  })
  onCleanup(
    sdk.event.on("permission.auto_accept.changed", ({ properties }) => {
      if (properties.directory !== (status()?.directory ?? sdk.directory)) return
      generation++
      setStatus(properties)
    }),
  )
  onCleanup(
    sdk.event.on("permission.auto_accepted", ({ properties }) => {
      if (properties.sessionID !== sessionID()) return
      toast.show({ message: t("ui.autoAccepted"), variant: "info", duration: 2_000 })
    }),
  )
  const toggle = async () => {
    if (busy()) return
    setBusy(true)
    const directory = sdk.directory
    try {
      const current = await requestAutoAccept(sdk)
      if (disposed || directory !== sdk.directory) return
      const next = await requestAutoAccept(sdk, !current.enabled)
      if (disposed || directory !== sdk.directory) return
      generation++
      setStatus(next)
      toast.show({
        message: next.managedDisabled
          ? t("ui.autoAcceptManagedOff")
          : next.enabled
            ? t("ui.autoAcceptOn")
            : t("ui.autoAcceptOff"),
        variant: next.managedDisabled ? "warning" : "info",
      })
    } catch {
      if (!disposed) toast.show({ message: t("ui.autoAcceptFailed"), variant: "error" })
    } finally {
      if (!disposed) setBusy(false)
    }
  }
  command.register(() => [autoAcceptCommand(t("ui.autoAcceptToggle"), toggle)])
  return { enabled: () => status()?.enabled === true, toggle }
}
