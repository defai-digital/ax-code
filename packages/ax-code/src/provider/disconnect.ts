import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { withRollback } from "@/util/rollback"
import { isDedicatedPrivateGpuProviderID } from "./private-gpu/presets"

type DisconnectOptions = {
  removeConfigIf?: (provider: Config.Provider) => boolean
  requireConfigRemoval?: boolean
}

/** Disconnect the observed credential while preserving a concurrent reconnect. */
export async function removeProviderConnection(providerID: string, options: DisconnectOptions = {}): Promise<boolean> {
  const removeAuth = await Auth.prepareRemoval(providerID)
  const rollback = await Config.removeGlobalProviderWithRollback(providerID, options.removeConfigIf)
  if (options.requireConfigRemoval && !rollback) return false
  // A failed credential publication leaves auth unchanged. Restore only the
  // config revision this operation still owns, without rewriting auth.
  const removed = await withRollback(removeAuth, rollback, "Failed to disconnect provider and restore its config")
  // Reconnect writes its credential before its config. If it replaced the
  // credential we observed, retain its config or restore our captured version.
  if (!removed) await rollback?.()
  return true
}

/** Auth disconnect also removes endpoint metadata owned by an editor. */
export async function disconnectProviderAuth(providerID: string): Promise<void> {
  const { CustomApiProvider } = await import("./custom-api-provider")
  await removeProviderConnection(providerID, {
    removeConfigIf: (provider) => isDedicatedPrivateGpuProviderID(providerID) || CustomApiProvider.isManaged(provider),
  })
}
