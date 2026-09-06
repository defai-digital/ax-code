import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useLocal } from "@tui/context/local"
import { map, pipe } from "remeda"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "../context/sdk"
import { DialogPrompt } from "../ui/dialog-prompt"
import { Link } from "../ui/link"
import { useTheme } from "../context/theme"
import { TextAttributes } from "ax-tui"
import type { ProviderAuthAuthorization, ProviderAuthMethod } from "@ax-code/sdk/v2"
import { DialogModel } from "./dialog-model"
import { DialogPrivateGpuConnect } from "./dialog-private-gpu"
import { useKeyboard } from "ax-tui/solid"
import { Clipboard } from "@tui/util/clipboard"
import { directoryRequestHeaders } from "@tui/util/request-headers"
import { urlAllowlistServerRoute } from "@tui/util/server-url"
import { useToast } from "../ui/toast"
import { which } from "@/util/which"
import { Log } from "@/util/log"
import {
  AX_TRUST_PROVIDER_OPTION_ID,
  CLI_BINARIES,
  axEngineRuntimeDialogActions,
  type AxEngineRuntimeAction,
  CLI_PROVIDERS,
  DEDICATED_PRIVATE_GPU_PROVIDERS,
  OFFLINE_PROVIDERS,
  configUpdateParams,
  CUSTOM_API_PROVIDER_OPTION_ID,
  normalizeConfiguredProvidersPayload,
  normalizeProviderListPayload,
  PROVIDER_DIALOG_CHANGE_TYPE_VALUE,
  providerDialogCategory,
  providerDialogCategoryOverrides,
  providerDialogConnected,
  providerDialogOptionsForType,
  providerDialogProviders,
  providerDialogTypeOptions,
  selectableProviderDefaultModelID,
  withCustomApiProviderDialogEntry,
  withAxTrustProviderDialogEntry,
} from "./dialog-provider-options"
import {
  configureCustomApiProvider,
  confirmCustomApiProviderDelete,
  customApiProviderManagementMenu,
  refreshCustomApiProviderModels,
  deleteCustomApiProvider,
  isManagedCustomApiProviderConfig,
  listCustomApiProviders,
} from "./dialog-custom-api-provider"
import { providerConnectCategoryMeta } from "@/mode/provider-category"
import { requireDedicatedPrivateGpuVendor } from "@/provider/private-gpu/presets"
import { disableProviderPatch, enableProviderPatch } from "@/provider/enablement"
import { isRetiredProviderID } from "@/provider/retired-providers"
import {
  localLlmRuntimePreset,
  localRuntimeEndpointPreset,
  normalizeLocalRuntimeBaseURL,
} from "@/provider/local-runtime"

type AxEngineTuiStatus = {
  eligibility?: { supported?: boolean; blockers?: string[]; warnings?: string[] }
  dependency?: { available?: boolean; binaryPath?: string; blockers?: string[] }
  disk?: { ok?: boolean; blockers?: string[]; freeBytes?: number }
  model?: { present?: boolean; modelID?: string; path?: string; blockers?: string[] }
  server?: { running?: boolean; ready?: boolean; blockers?: string[] }
  capability?: { toolcall?: boolean; reason?: string }
}

function offlineProviderHint() {
  return "not running"
}

function sdkErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (typeof error === "string" && error) return error
  if (typeof error === "object" && error) {
    const candidate = error as { data?: { message?: string }; message?: string }
    return candidate.data?.message ?? candidate.message ?? fallback
  }
  return fallback
}

const log = Log.create({ service: "tui.dialog-provider" })

function runProviderDialogAction(input: {
  providerID: string
  action: string
  fallbackMessage: string
  toast: ReturnType<typeof useToast>
  run: () => Promise<void> | void
}) {
  // Return the promise so DialogSelect's confirmInFlight latch spans the full
  // connect/disconnect/replace flow (including nested action menus). Fire-and-
  // forget here used to release the parent latch before the nested "already
  // connected" menu mounted, so a residual Enter auto-selected "Use saved key"
  // and skipped Disconnect / Replace key entirely.
  return Promise.resolve()
    .then(input.run)
    .catch((error) => {
      log.warn("provider dialog action failed", {
        error,
        providerID: input.providerID,
        action: input.action,
      })
      input.toast.show({
        message: error instanceof Error ? error.message : input.fallbackMessage,
        variant: "error",
      })
    })
}

async function axEngineRequest<T>(
  sdk: ReturnType<typeof useSDK>,
  path: "status" | "prepare" | "start" | "stop",
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await sdk.fetch(urlAllowlistServerRoute(sdk.url, `/provider/ax-engine/${path}`), {
    method: path === "status" ? "GET" : "POST",
    headers: directoryRequestHeaders({
      directory: sdk.directory,
      contentType: path === "status" ? undefined : "application/json",
    }),
    body: path === "status" ? undefined : JSON.stringify(body ?? {}),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(text || `AX Engine request failed with HTTP ${response.status}`)
  }
  return (await response.json()) as T
}

type PrivateGpuConnectionView = {
  providerID?: string
  baseURL: string
  models: string[]
}

async function privateGpuConnectionRequest(
  sdk: ReturnType<typeof useSDK>,
  body: { providerID: string; baseURL: string; apiKey: string },
): Promise<PrivateGpuConnectionView> {
  const response = await sdk.fetch(urlAllowlistServerRoute(sdk.url, "/provider/private-gpu/connection"), {
    method: "PUT",
    headers: directoryRequestHeaders({
      directory: sdk.directory,
      contentType: "application/json",
    }),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const payload = (await response.json().catch(() => undefined)) as { message?: string } | undefined
    throw new Error(payload?.message ?? `Private GPU connection failed with HTTP ${response.status}`)
  }
  return (await response.json()) as PrivateGpuConnectionView
}

function privateGpuBaseURLPreset(providerID: string, config: unknown) {
  const vendor = requireDedicatedPrivateGpuVendor(providerID)
  const providerConfig = (config as { provider?: Record<string, { options?: { baseURL?: string } }> } | undefined)
    ?.provider?.[providerID]
  const fromEnv = vendor.envBaseURL ? process.env[vendor.envBaseURL] : undefined
  return providerConfig?.options?.baseURL ?? fromEnv ?? vendor.defaultApi ?? ""
}

export async function configureAxEngineLocalRuntime(
  sdk: Pick<ReturnType<typeof useSDK>, "url" | "directory" | "fetch">,
): Promise<void> {
  const response = await sdk.fetch(urlAllowlistServerRoute(sdk.url, "/provider/ax-engine/connection"), {
    method: "PUT",
    headers: directoryRequestHeaders({ directory: sdk.directory, contentType: "application/json" }),
    body: JSON.stringify({ mode: "managed" }),
  })
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => undefined)
    throw new Error(sdkErrorMessage(payload, `AX Engine setup failed with HTTP ${response.status}`))
  }
  await response.body?.cancel()
}

function renderAxEngineStatusText(status: AxEngineTuiStatus) {
  const lines = [
    `Eligibility: ${status.eligibility?.supported ? "ok" : "blocked"}`,
    ...(status.eligibility?.blockers ?? []),
    ...(status.eligibility?.warnings ?? []),
    `Dependency: ${status.dependency?.available ? status.dependency.binaryPath : "missing"}`,
    ...(status.dependency?.blockers ?? []),
    `Disk: ${status.disk?.ok ? "ok" : "blocked"}`,
    ...(status.disk?.blockers ?? []),
    `Model: ${status.model?.present ? `${status.model.modelID ?? "unknown"} at ${status.model.path}` : "not prepared"}`,
    ...(status.model?.blockers ?? []),
    `Local runtime: ${status.server?.ready ? "ready" : status.server?.running ? "running but not ready" : "stopped"}`,
    ...(status.server?.blockers ?? []),
    status.capability?.toolcall === false ? status.capability.reason : undefined,
  ]
  return lines.filter((line): line is string => !!line)
}

function showAxEngineStatusDialog(input: {
  dialog: ReturnType<typeof useDialog>
  theme: ReturnType<typeof useTheme>["theme"]
  status: AxEngineTuiStatus
}) {
  const lines = renderAxEngineStatusText(input.status)
  input.dialog.replace(() => (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={input.theme.text}>
          AX Engine status
        </text>
        <text fg={input.theme.textMuted} onMouseUp={() => input.dialog.clear()}>
          esc
        </text>
      </box>
      <box gap={1}>
        {lines.map((line) => (
          <text fg={line.includes("AX_ENGINE_") ? input.theme.warning : input.theme.textMuted}>{line}</text>
        ))}
      </box>
    </box>
  ))
}

// Temporarily turn a provider off/on via global config `disabled_providers`.
// Credentials in auth.json are kept, so this is reversible — unlike
// Disconnect, which deletes them. Provider-only global config updates refresh
// Config and Provider caches without disposing active session state; bootstrap
// refreshes the dialog's provider rows after that scoped invalidation.
export async function setProviderDisabled(input: {
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  toast: ReturnType<typeof useToast>
  dialog: ReturnType<typeof useDialog>
  providerID: string
  providerName: string
  disabled: boolean
}) {
  const current = await input.sdk.client.global.config.get()
  const patch = input.disabled
    ? disableProviderPatch(current.data as any, input.providerID)
    : enableProviderPatch(current.data as any, input.providerID)
  const updated = await input.sdk.client.global.config.update({ config: patch as any })
  if (updated.error) {
    input.toast.show({ variant: "error", message: JSON.stringify(updated.error) })
    return
  }
  await input.sync.bootstrap()
  input.toast.show({
    variant: "success",
    message: input.disabled ? `Disabled ${input.providerName} — credentials kept` : `Enabled ${input.providerName}`,
  })
  input.dialog.clear()
}

export function createDialogProviderOptions() {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()
  const local = useLocal()
  const { theme } = useTheme()

  async function refreshConfiguredProviders() {
    const response = await sdk.client.config.providers({}, { throwOnError: true })
    const data = normalizeConfiguredProvidersPayload<(typeof sync.data.provider)[number]>(response.data)
    sync.set("provider", data.providers)
    sync.set("provider_default", data.default)
    sync.set("provider_loaded", true)
    sync.set("provider_failed", false)
  }

  async function updateConfig(config: Record<string, unknown>) {
    // Provider endpoints are trusted user settings. Project config strips them.
    await sdk.client.global.config.update(configUpdateParams(config) as any, { throwOnError: true })
  }

  function promptPrivateGpu(providerID: string, providerName: string) {
    const vendor = requireDedicatedPrivateGpuVendor(providerID)
    dialog.replace(() => (
      <DialogPrivateGpuConnect
        vendor={vendor}
        title={`Connect ${providerName}`}
        defaultBaseURL={privateGpuBaseURLPreset(providerID, sync.data.config)}
        onConfirm={({ baseURL, apiKey }) =>
          runProviderDialogAction({
            providerID,
            action: "private-gpu-connect",
            fallbackMessage: `Failed to connect ${providerName}`,
            toast,
            run: async () => {
              const connection = await privateGpuConnectionRequest(sdk, { providerID, baseURL, apiKey })
              await sdk.client.instance.dispose()
              await sync.bootstrap()
              toast.show({
                variant: "success",
                message: `Connected ${providerName} (${connection.models.join(", ") || "no models"})`,
              })
              await openModelDialogForProvider(providerID, providerName)
            },
          })
        }
      />
    ))
  }

  async function openModelDialogForProvider(providerID: string, providerName: string) {
    await refreshConfiguredProviders()
    let provider = sync.data.provider.find((item) => item.id === providerID)
    if (providerID === "ax-engine" && (!provider || Object.keys(provider.models).length === 0)) {
      await configureAxEngineLocalRuntime(sdk)
      await sdk.client.instance.dispose()
      await sync.bootstrap()
      await refreshConfiguredProviders()
      provider = sync.data.provider.find((item) => item.id === providerID)
    }
    if (!provider || Object.keys(provider.models).length === 0) {
      const response = await sdk.client.provider.list({}, { throwOnError: true })
      const data = normalizeProviderListPayload(response.data)
      const available = data.all.find((item) => item.id === providerID) as
        | (typeof sync.data.provider)[number]
        | undefined
      sync.set("provider_next", data)
      if (providerID !== "ax-engine" && available && Object.keys(available.models).length > 0) {
        const existing = sync.data.provider.filter((item) => item.id !== providerID)
        sync.set("provider", [...existing, available])
        sync.set("provider_default", providerID, data.default[providerID] ?? Object.keys(available.models)[0] ?? "")
        sync.set("provider_loaded", true)
        sync.set("provider_failed", false)
        provider = available
      }
    }
    if (!provider || Object.keys(provider.models).length === 0) {
      toast.show({
        variant: "warning",
        message: `${providerName} connected, but no selectable models are available yet`,
        duration: 3000,
      })
      dialog.replace(() => <DialogProvider />)
      return
    }
    dialog.replace(() => <DialogModel providerID={providerID} />)
  }

  async function selectDefaultModelForProvider(providerID: string, providerName: string) {
    await refreshConfiguredProviders()
    let provider = sync.data.provider.find((item) => item.id === providerID)
    if (!provider || Object.keys(provider.models).length === 0) {
      const response = await sdk.client.provider.list({}, { throwOnError: true })
      const data = normalizeProviderListPayload(response.data)
      const available = data.all.find((item) => item.id === providerID) as
        | (typeof sync.data.provider)[number]
        | undefined
      sync.set("provider_next", data)
      if (available && Object.keys(available.models).length > 0) {
        const existing = sync.data.provider.filter((item) => item.id !== providerID)
        sync.set("provider", [...existing, available])
        sync.set("provider_default", providerID, data.default[providerID] ?? Object.keys(available.models)[0] ?? "")
        sync.set("provider_loaded", true)
        sync.set("provider_failed", false)
        provider = available
      }
    }

    const modelID = selectableProviderDefaultModelID({
      providerID,
      models: provider?.models ?? {},
      defaultModel: sync.data.provider_default[providerID],
    })

    if (!modelID) {
      throw new Error(`${providerName} connected, but no selectable models are available yet`)
    }

    local.model.set({ providerID, modelID }, { recent: true })
  }

  const options = createMemo(() => {
    const categoryOverrides = providerDialogCategoryOverrides(sync.data.config)
    return pipe(
      providerDialogProviders({
        available: sync.data.provider_next.all,
        configured: sync.data.provider,
        categoryOverrides,
      }),
      (providers) => withCustomApiProviderDialogEntry(providers, categoryOverrides),
      (providers) => withAxTrustProviderDialogEntry(providers, categoryOverrides),
      map((provider) => {
        const isConnected = providerDialogConnected({
          providerID: provider.id,
          connected: sync.data.provider_next.connected,
          configured: sync.data.provider,
        })
        const isOfflineKind = OFFLINE_PROVIDERS.has(provider.id)
        return {
          title: localLlmRuntimePreset(provider.id)?.label ?? provider.name,
          value: provider.id,
          description: isConnected ? "Connected" : isOfflineKind ? offlineProviderHint() : undefined,
          descriptionFg: isConnected ? theme.warning : isOfflineKind ? theme.textMuted : undefined,
          category: providerDialogCategory(provider.id, categoryOverrides),
          onSelect() {
            return runProviderDialogAction({
              providerID: provider.id,
              action: "select-provider",
              fallbackMessage: `Failed to update ${provider.name}`,
              toast,
              run: async () => {
                if (provider.id === CUSTOM_API_PROVIDER_OPTION_ID || provider.id === AX_TRUST_PROVIDER_OPTION_ID) {
                  const saved = await configureCustomApiProvider({
                    dialog,
                    sdk,
                    theme,
                    management: provider.id === AX_TRUST_PROVIDER_OPTION_ID ? "ax-trust" : undefined,
                  })
                  if (!saved) return
                  await sync.bootstrap()
                  toast.show({ variant: "success", message: `Saved ${saved.name}` })
                  await openModelDialogForProvider(saved.providerID, saved.name)
                  return
                }

                const isConnected = providerDialogConnected({
                  providerID: provider.id,
                  connected: sync.data.provider_next.connected,
                  configured: sync.data.provider,
                })

                if (isManagedCustomApiProviderConfig(sync.data.config, provider.id)) {
                  const existing = (await listCustomApiProviders(sdk)).find(
                    (candidate) => candidate.providerID === provider.id,
                  )
                  if (!existing) throw new Error(`Managed custom provider ${provider.id} is unavailable`)
                  const action = await customApiProviderManagementMenu({ dialog, provider: existing })
                  if (action === null) return
                  if (action === "use") {
                    await openModelDialogForProvider(existing.providerID, existing.name)
                    return
                  }
                  if (action === "update") {
                    const saved = await configureCustomApiProvider({ dialog, sdk, theme, existing })
                    if (!saved) return
                    await sync.bootstrap()
                    toast.show({ variant: "success", message: `Updated ${saved.name}` })
                    await openModelDialogForProvider(saved.providerID, saved.name)
                    return
                  }
                  if (action === "refresh") {
                    const saved = await refreshCustomApiProviderModels(sdk, existing)
                    await sync.bootstrap()
                    toast.show({
                      variant: "success",
                      message: `Loaded ${saved.models.length} models for ${saved.name}`,
                    })
                    await openModelDialogForProvider(saved.providerID, saved.name)
                    return
                  }
                  if (!(await confirmCustomApiProviderDelete({ dialog, provider: existing }))) return
                  await deleteCustomApiProvider(sdk, existing.providerID)
                  await sync.bootstrap()
                  toast.show({ variant: "success", message: `Deleted ${existing.name}` })
                  dialog.clear()
                  return
                }

                if (DEDICATED_PRIVATE_GPU_PROVIDERS.has(provider.id)) {
                  if (isConnected) {
                    const action = await new Promise<"use" | "replace" | "remove" | null>((resolve) => {
                      dialog.replace(
                        () => (
                          <DialogSelect
                            title={`${provider.name} — connected`}
                            options={[
                              {
                                title: "Select a model",
                                value: "use" as const,
                                description: "Use models discovered from /models",
                              },
                              {
                                title: "Replace endpoint",
                                value: "replace" as const,
                                description:
                                  privateGpuBaseURLPreset(provider.id, sync.data.config) || "Enter a new URL and token",
                              },
                              {
                                title: "Disconnect",
                                value: "remove" as const,
                                description: "Remove saved credentials and endpoint",
                              },
                            ]}
                            onSelect={(option) => resolve(option.value)}
                          />
                        ),
                        () => resolve(null),
                      )
                    })
                    if (action === null) return
                    if (action === "use") {
                      await openModelDialogForProvider(provider.id, provider.name)
                      return
                    }
                    if (action === "remove") {
                      const removed = await sdk.client.auth.remove({ providerID: provider.id })
                      if (removed.error) {
                        toast.show({ variant: "error", message: JSON.stringify(removed.error) })
                        return
                      }
                      await sdk.client.instance.dispose()
                      await sync.bootstrap()
                      toast.show({ variant: "success", message: `Disconnected ${provider.name}` })
                      dialog.clear()
                      return
                    }
                  }
                  promptPrivateGpu(provider.id, provider.name)
                  return
                }

                if (provider.id === "ax-engine") {
                  const status = await axEngineRequest<AxEngineTuiStatus>(sdk, "status")
                  const action = await new Promise<AxEngineRuntimeAction | null>((resolve) => {
                    dialog.replace(
                      () => (
                        <DialogSelect
                          title="AX Engine"
                          options={axEngineRuntimeDialogActions({
                            serverRunning: status.server?.running,
                            serverReady: status.server?.ready,
                            statusBlocker: status.model?.blockers?.[0] ?? status.dependency?.blockers?.[0],
                          })}
                          onSelect={(option) => resolve(option.value)}
                        />
                      ),
                      () => resolve(null),
                    )
                  })
                  if (action === null) return
                  if (action === "disable") {
                    if (status.server?.running) {
                      try {
                        await axEngineRequest(sdk, "stop")
                      } catch (error) {
                        log.warn("failed to stop ax-engine while disabling", { error })
                      }
                    }
                    await setProviderDisabled({
                      sdk,
                      sync,
                      toast,
                      dialog,
                      providerID: provider.id,
                      providerName: provider.name,
                      disabled: true,
                    })
                    return
                  }
                  if (action === "status") {
                    showAxEngineStatusDialog({ dialog, theme, status })
                    return
                  }
                  if (action === "stop") {
                    await axEngineRequest(sdk, "stop")
                    await sdk.client.instance.dispose()
                    await sync.bootstrap()
                    toast.show({ variant: "success", message: "AX Engine local runtime stopped" })
                    dialog.clear()
                    return
                  }
                  if (!status.eligibility?.supported) {
                    throw new Error(
                      status.eligibility?.blockers?.[0] ??
                        status.dependency?.blockers?.[0] ??
                        "AX Engine is not supported on this host",
                    )
                  }
                  // Explicit local setup also clears legacy attach settings and
                  // overrides AX_ENGINE_HOST on the server without asking for a URL.
                  await configureAxEngineLocalRuntime(sdk)
                  await sync.bootstrap()
                  await openModelDialogForProvider(provider.id, provider.name)
                  return
                }

                if (isOfflineKind) {
                  const saveEndpoint = async (value: string) => {
                    const baseURL = normalizeLocalRuntimeBaseURL(value)
                    await updateConfig({
                      provider: {
                        [provider.id]: {
                          options: {
                            baseURL,
                          },
                        },
                      },
                    })
                    await sync.bootstrap()
                    toast.show({ variant: "success", message: `Updated ${provider.name} endpoint` })
                    if (
                      providerDialogConnected({
                        providerID: provider.id,
                        connected: sync.data.provider_next.connected,
                        configured: sync.data.provider,
                      })
                    ) {
                      dialog.replace(() => <DialogModel providerID={provider.id} />)
                    } else {
                      dialog.clear()
                    }
                  }

                  const promptEndpoint = () =>
                    dialog.replace(() => (
                      <DialogPrompt
                        title={`${provider.name} endpoint`}
                        value={localRuntimeEndpointPreset(provider.id, sync.data.config)}
                        placeholder={provider.id === "local-llm" ? "http://localhost:8080" : "http://localhost:1234"}
                        description={() => (
                          <box gap={1}>
                            <text fg={theme.textMuted}>
                              {provider.id === "local-llm"
                                ? "Enter the base URL of your OpenAI-compatible server."
                                : "Press enter to use the preset, or edit the host and port."}
                            </text>
                            <text fg={theme.textMuted}>You can include /v1, but ax-code will add it if omitted.</text>
                          </box>
                        )}
                        onConfirm={(value) => {
                          if (!value) return
                          return runProviderDialogAction({
                            providerID: provider.id,
                            action: "offline-endpoint-confirm",
                            fallbackMessage: `Failed to update ${provider.name} endpoint`,
                            toast,
                            run: () => saveEndpoint(value),
                          })
                        }}
                      />
                    ))

                  if (isConnected) {
                    const action = await new Promise<"use" | "endpoint" | "disable" | null>((resolve) => {
                      dialog.replace(
                        () => (
                          <DialogSelect
                            title={`${provider.name} — connected`}
                            options={[
                              {
                                title: "Select a model",
                                value: "use" as const,
                                description: "Use discovered local models",
                              },
                              {
                                title: "Change endpoint",
                                value: "endpoint" as const,
                                description: localRuntimeEndpointPreset(provider.id, sync.data.config),
                              },
                              {
                                title: "Disable",
                                value: "disable" as const,
                                description: "Turn off temporarily — keeps endpoint config",
                              },
                            ]}
                            onSelect={(option) => resolve(option.value)}
                          />
                        ),
                        () => resolve(null),
                      )
                    })
                    if (action === "use") dialog.replace(() => <DialogModel providerID={provider.id} />)
                    else if (action === "endpoint") promptEndpoint()
                    else if (action === "disable")
                      await setProviderDisabled({
                        sdk,
                        sync,
                        toast,
                        dialog,
                        providerID: provider.id,
                        providerName: provider.name,
                        disabled: true,
                      })
                  } else {
                    promptEndpoint()
                  }
                  return
                }

                // CLI providers — check binary availability, support connect/disconnect
                if (CLI_PROVIDERS.has(provider.id)) {
                  const binary = CLI_BINARIES[provider.id]
                  const available = binary ? which(binary) !== null : false

                  if (!available) {
                    dialog.replace(() => (
                      <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
                        <box flexDirection="row" justifyContent="space-between">
                          <text attributes={TextAttributes.BOLD} fg={theme.text}>
                            {provider.name} — CLI not found
                          </text>
                          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
                            esc
                          </text>
                        </box>
                        <text fg={theme.textMuted}>
                          Install the CLI and ensure it is available in your PATH, then close this message and select
                          the provider again.
                        </text>
                      </box>
                    ))
                    return
                  }

                  if (isConnected) {
                    const action = await new Promise<"use" | "disconnect" | "disable" | null>((resolve) => {
                      dialog.replace(
                        () => (
                          <DialogSelect
                            title={`${provider.name} — connected`}
                            options={[
                              {
                                title: "Use CLI default",
                                value: "use" as const,
                                description: "Uses your CLI configuration",
                              },
                              {
                                title: "Disable",
                                value: "disable" as const,
                                description: "Turn off temporarily — keeps the connection",
                              },
                              {
                                title: "Disconnect",
                                value: "disconnect" as const,
                                description: "Remove this CLI provider",
                              },
                            ]}
                            onSelect={(option) => resolve(option.value)}
                          />
                        ),
                        () => resolve(null),
                      )
                    })
                    if (action === "use") {
                      await selectDefaultModelForProvider(provider.id, provider.name)
                      toast.show({ variant: "success", message: `Using ${provider.name}` })
                      dialog.clear()
                    } else if (action === "disable") {
                      await setProviderDisabled({
                        sdk,
                        sync,
                        toast,
                        dialog,
                        providerID: provider.id,
                        providerName: provider.name,
                        disabled: true,
                      })
                    } else if (action === "disconnect") {
                      const removed = await sdk.client.auth.remove({ providerID: provider.id })
                      if (removed.error) {
                        toast.show({ variant: "error", message: JSON.stringify(removed.error) })
                        return
                      }
                      await sdk.client.instance.dispose()
                      await sync.bootstrap()
                      toast.show({ variant: "success", message: `Disconnected ${provider.name}` })
                      dialog.clear()
                    }
                  } else {
                    // Connect: store a marker in auth.json so provider persists as connected
                    const stored = await sdk.client.auth.set({
                      providerID: provider.id,
                      auth: { type: "api", key: "cli" },
                    })
                    if (stored.error) {
                      toast.show({ variant: "error", message: JSON.stringify(stored.error) })
                      return
                    }
                    await sdk.client.instance.dispose()
                    await sync.bootstrap()
                    await selectDefaultModelForProvider(provider.id, provider.name)
                    toast.show({ variant: "success", message: `Connected ${provider.name}` })
                    dialog.clear()
                  }
                  return
                }

                // If provider already has a saved key, offer to use it or replace it
                if (isConnected) {
                  const action = await new Promise<"use" | "replace" | "disable" | "remove" | null>((resolve) => {
                    dialog.replace(
                      () => (
                        <DialogSelect
                          title={`${provider.name} — already connected`}
                          options={[
                            {
                              title: "Use saved key",
                              value: "use" as const,
                              description: "Select a model from this provider",
                            },
                            {
                              title: "Replace key",
                              value: "replace" as const,
                              description: "Enter a new API key",
                            },
                            {
                              title: "Disable",
                              value: "disable" as const,
                              description: "Turn off temporarily — keeps credentials",
                            },
                            {
                              title: "Disconnect",
                              value: "remove" as const,
                              description: "Remove saved credentials",
                            },
                          ]}
                          onSelect={(option) => resolve(option.value)}
                        />
                      ),
                      () => resolve(null),
                    )
                  })
                  if (action === null) return
                  if (action === "use") {
                    dialog.replace(() => <DialogModel providerID={provider.id} />)
                    return
                  }
                  if (action === "disable") {
                    await setProviderDisabled({
                      sdk,
                      sync,
                      toast,
                      dialog,
                      providerID: provider.id,
                      providerName: provider.name,
                      disabled: true,
                    })
                    return
                  }
                  if (action === "remove") {
                    const removed = await sdk.client.auth.remove({ providerID: provider.id })
                    if (removed.error) {
                      toast.show({ variant: "error", message: JSON.stringify(removed.error) })
                      return
                    }
                    await sdk.client.instance.dispose()
                    await sync.bootstrap()
                    toast.show({ variant: "success", message: `Disconnected ${provider.name}` })
                    dialog.clear()
                    return
                  }
                  // action === "replace" → fall through to auth flow
                }

                const methods = sync.data.provider_auth[provider.id] ?? [
                  {
                    type: "api",
                    label: "API key",
                  },
                ]
                let index: number | null = 0
                if (methods.length > 1) {
                  index = await new Promise<number | null>((resolve) => {
                    dialog.replace(
                      () => (
                        <DialogSelect
                          title="Select auth method"
                          options={methods.map((x, index) => ({
                            title: x.label,
                            value: index,
                          }))}
                          onSelect={(option) => resolve(option.value)}
                        />
                      ),
                      () => resolve(null),
                    )
                  })
                }
                if (index == null) return
                const method = methods[index]
                if (method.type === "oauth") {
                  let inputs: Record<string, string> | undefined
                  if (method.prompts?.length) {
                    const value = await PromptsMethod({
                      dialog,
                      prompts: method.prompts,
                    })
                    if (!value) {
                      // A dismissed prompt aborts the flow; say so instead of
                      // silently dropping the connection attempt.
                      toast.show({ variant: "info", message: `Cancelled connecting ${provider.name}` })
                      return
                    }
                    inputs = value
                  }

                  const result = await sdk.client.provider.oauth.authorize({
                    providerID: provider.id,
                    method: index,
                    inputs,
                  })
                  if (result.error) {
                    toast.show({
                      variant: "error",
                      message: JSON.stringify(result.error),
                    })
                    dialog.clear()
                    return
                  }
                  const authorization = result.data
                  if (!authorization) {
                    toast.show({
                      variant: "error",
                      message: "Provider authorization returned no data",
                    })
                    dialog.clear()
                    return
                  }
                  if (authorization.method === "code") {
                    dialog.replace(() => (
                      <CodeMethod
                        providerID={provider.id}
                        title={method.label}
                        index={index}
                        authorization={authorization}
                      />
                    ))
                  }
                  if (authorization.method === "auto") {
                    dialog.replace(() => (
                      <AutoMethod
                        providerID={provider.id}
                        title={method.label}
                        index={index}
                        authorization={authorization}
                      />
                    ))
                  }
                }
                if (method.type === "api") {
                  return dialog.replace(() => <ApiMethod providerID={provider.id} title={method.label} />)
                }
              },
            })
          },
        }
      }),
    )
  })
  return options
}

export function DialogProvider() {
  const options = createDialogProviderOptions()
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()

  // Disabled providers are filtered out of provider.list server-side, so they
  // never appear in the category lists. Surface them from config here, since
  // this dialog is the only way back without hand-editing ax-code.json.
  const disabledProviders = createMemo(() =>
    (sync.data.config?.disabled_providers ?? []).filter((providerID) => !isRetiredProviderID(providerID)),
  )

  const typeOptions = createMemo(() => {
    const categoryOverrides = providerDialogCategoryOverrides(sync.data.config)
    // Widened from the providerDialogTypeOptions return type so the synthetic
    // "Disabled" entry (not a real connect category) can be appended.
    const types: { title: string; value: string; description?: string; hint?: string; onSelect(): void }[] =
      providerDialogTypeOptions(
        options().map((option) => option.value),
        categoryOverrides,
      ).map((type) => ({
        ...type,
        onSelect() {
          if (type.value === "ax-engine") {
            return options()
              .find((option) => option.value === "ax-engine")
              ?.onSelect()
          }
          // Replace the dialog instead of swapping DialogSelect in place. An
          // in-place remount kept the residual Enter from this confirm and
          // immediately activated the first filtered row (previously Change
          // type), so type select looked like a no-op.
          dialog.replace(() => (
            <DialogSelect
              title={providerConnectCategoryMeta(type.value).label}
              options={providerDialogOptionsForType(options(), type.value, categoryOverrides).map((option) =>
                option.value === PROVIDER_DIALOG_CHANGE_TYPE_VALUE
                  ? {
                      ...option,
                      onSelect() {
                        dialog.replace(() => <DialogProvider />)
                      },
                    }
                  : option,
              )}
            />
          ))
        },
      }))
    if (disabledProviders().length > 0) {
      types.push({
        title: "Disabled",
        value: "__disabled__",
        description: `${disabledProviders().length} provider${disabledProviders().length === 1 ? "" : "s"} turned off — re-enable or disconnect`,
        hint: undefined,
        onSelect() {
          dialog.replace(() => (
            <DialogSelect
              title="Disabled providers"
              options={disabledProviders().map((providerID) => ({
                title: providerID,
                value: providerID,
                description: "Currently disabled — credentials kept",
                onSelect() {
                  return runProviderDialogAction({
                    providerID,
                    action: "manage-disabled-provider",
                    fallbackMessage: `Failed to update ${providerID}`,
                    toast,
                    run: async () => {
                      const action = await new Promise<"enable" | "disconnect" | null>((resolve) => {
                        dialog.replace(
                          () => (
                            <DialogSelect
                              title={`${providerID} — disabled`}
                              options={[
                                {
                                  title: "Enable",
                                  value: "enable" as const,
                                  description: "Turn back on — uses saved credentials",
                                },
                                {
                                  title: "Disconnect",
                                  value: "disconnect" as const,
                                  description: "Remove saved credentials",
                                },
                              ]}
                              onSelect={(option) => resolve(option.value)}
                            />
                          ),
                          () => resolve(null),
                        )
                      })
                      if (action === "enable") {
                        await setProviderDisabled({
                          sdk,
                          sync,
                          toast,
                          dialog,
                          providerID,
                          providerName: providerID,
                          disabled: false,
                        })
                      } else if (action === "disconnect") {
                        // Re-enable first so the provider is not left behind in
                        // disabled_providers with no credentials.
                        await setProviderDisabled({
                          sdk,
                          sync,
                          toast,
                          dialog,
                          providerID,
                          providerName: providerID,
                          disabled: false,
                        })
                        const removed = await sdk.client.auth.remove({ providerID })
                        if (removed.error) {
                          toast.show({ variant: "error", message: JSON.stringify(removed.error) })
                          return
                        }
                        await sdk.client.instance.dispose()
                        await sync.bootstrap()
                        toast.show({ variant: "success", message: `Disconnected ${providerID}` })
                        dialog.clear()
                      }
                    },
                  })
                },
              }))}
            />
          ))
        },
      })
    }
    return types
  })

  return <DialogSelect title="Provider type" options={typeOptions()} />
}

interface AutoMethodProps {
  index: number
  providerID: string
  title: string
  authorization: ProviderAuthAuthorization
}
function AutoMethod(props: AutoMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()

  useKeyboard((evt) => {
    if (evt.name === "c" && !evt.ctrl && !evt.meta) {
      const code = props.authorization.instructions.match(/[A-Z0-9]{4}-[A-Z0-9]{4,5}/)?.[0] ?? props.authorization.url
      Clipboard.copy(code)
        .then(() => toast.show({ message: "Copied to clipboard", variant: "info", duration: 1500 }))
        .catch(toast.error)
    }
  })

  onMount(() => {
    let cancelled = false
    void (async () => {
      const result = await sdk.client.provider.oauth.callback({
        providerID: props.providerID,
        method: props.index,
      })
      if (result.error) {
        // A failed device/auto flow resolves with an { error } payload rather
        // than rejecting; surface it (mirroring the authorize step) unless the
        // user already dismissed the dialog by pressing esc.
        if (!cancelled) {
          toast.show({ variant: "error", message: JSON.stringify(result.error) })
          dialog.clear()
        }
        return
      }
      // Even if the user pressed esc while waiting, a late browser completion
      // still stored credentials server-side. Dispose + bootstrap so the TUI
      // reflects the now-connected provider; only skip advancing to the model
      // picker (there is no server-side cancel to undo the auth).
      await sdk.client.instance.dispose()
      await sync.bootstrap()
      if (cancelled) return
      dialog.replace(() => <DialogModel providerID={props.providerID} />)
    })().catch((error) => {
      if (cancelled) return
      toast.show({
        message: error instanceof Error ? error.message : "Failed to complete provider authorization",
        variant: "error",
      })
      dialog.clear()
    })
    onCleanup(() => {
      cancelled = true
    })
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box gap={1}>
        <Link href={props.authorization.url} fg={theme.primary} />
        <text fg={theme.textMuted}>{props.authorization.instructions}</text>
      </box>
      <text fg={theme.textMuted}>Waiting for authorization...</text>
      <text fg={theme.text}>
        c <span style={{ fg: theme.textMuted }}>copy</span>
      </text>
    </box>
  )
}

interface CodeMethodProps {
  index: number
  title: string
  providerID: string
  authorization: ProviderAuthAuthorization
}
function CodeMethod(props: CodeMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const [error, setError] = createSignal<string | null>(null)

  return (
    <DialogPrompt
      title={props.title}
      placeholder="Authorization code"
      autoClose={false}
      onConfirm={async (value) => {
        // Keep the prompt open until auth resolves. On failure, stay open and
        // surface the inline error state instead of closing before the async
        // result is known. See #257.
        if (!value) {
          setError("Invalid code")
          return
        }
        const result = await sdk.client.provider.oauth.callback({
          providerID: props.providerID,
          method: props.index,
          code: value,
        })
        if (result.error) {
          // The callback resolves with an { error } payload rather than
          // rejecting. Surface the server-provided reason (e.g. an expired or
          // network failure) and only fall back to the generic "Invalid code"
          // when the payload carries no message of its own.
          setError(sdkErrorMessage(result.error, "Invalid code"))
          return
        }
        setError(null)
        await sdk.client.instance.dispose()
        await sync.bootstrap()
        dialog.replace(() => <DialogModel providerID={props.providerID} />)
      }}
      description={() => (
        <box gap={1}>
          <text fg={theme.textMuted}>{props.authorization.instructions}</text>
          <Link href={props.authorization.url} fg={theme.primary} />
          <Show when={error()}>{(message) => <text fg={theme.error}>{message()}</text>}</Show>
        </box>
      )}
    />
  )
}

interface ApiMethodProps {
  providerID: string
  title: string
}
function ApiMethod(props: ApiMethodProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()

  return (
    <DialogPrompt
      title={props.title}
      placeholder="API key"
      description={undefined}
      autoClose={false}
      onConfirm={async (value) => {
        // An empty key must not close the prompt or clear auth state; keep the
        // dialog open and tell the user. A failed auth.set (which resolves with
        // an { error } payload rather than rejecting) also keeps the dialog open
        // (autoClose is false) and surfaces via toast instead of falsely
        // advancing to the model picker. See #257.
        if (!value) {
          toast.show({ message: "API key is required", variant: "error" })
          return
        }
        const stored = await sdk.client.auth.set({
          providerID: props.providerID,
          auth: {
            type: "api",
            key: value,
          },
        })
        if (stored.error) {
          toast.show({ message: JSON.stringify(stored.error), variant: "error" })
          return
        }
        await sdk.client.instance.dispose()
        await sync.bootstrap()
        dialog.replace(() => <DialogModel providerID={props.providerID} />)
      }}
    />
  )
}

interface PromptsMethodProps {
  dialog: ReturnType<typeof useDialog>
  prompts: NonNullable<ProviderAuthMethod["prompts"]>[number][]
}
async function PromptsMethod(props: PromptsMethodProps) {
  const inputs: Record<string, string> = {}
  for (const prompt of props.prompts) {
    if (prompt.when) {
      const value = inputs[prompt.when.key]
      if (value === undefined) continue
      const matches = prompt.when.op === "eq" ? value === prompt.when.value : value !== prompt.when.value
      if (!matches) continue
    }

    if (prompt.type === "select") {
      const value = await new Promise<string | null>((resolve) => {
        props.dialog.replace(
          () => (
            <DialogSelect
              title={prompt.message}
              options={prompt.options.map((x) => ({
                title: x.label,
                value: x.value,
                description: x.hint,
              }))}
              onSelect={(option) => resolve(option.value)}
            />
          ),
          () => resolve(null),
        )
      })
      if (value === null) return null
      inputs[prompt.key] = value
      continue
    }

    const value = await new Promise<string | null>((resolve) => {
      props.dialog.replace(
        () => (
          <DialogPrompt
            title={prompt.message}
            placeholder={prompt.placeholder}
            // Keep the prompt open after confirm: the default deferred
            // dialog.clear() would fire after the loop has already replace()d
            // the next prompt, closing it and silently aborting the flow
            // (mirrors CodeMethod/ApiMethod). See #257.
            autoClose={false}
            onConfirm={(value) => resolve(value)}
          />
        ),
        () => resolve(null),
      )
    })
    if (value === null) return null
    inputs[prompt.key] = value
  }
  return inputs
}
