import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { map, pipe } from "remeda"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "../context/sdk"
import { DialogPrompt } from "../ui/dialog-prompt"
import { Link } from "../ui/link"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import type { ProviderAuthAuthorization, ProviderAuthMethod } from "@ax-code/sdk/v2"
import { DialogModel } from "./dialog-model"
import { useKeyboard } from "@opentui/solid"
import { Clipboard } from "@tui/util/clipboard"
import { useToast } from "../ui/toast"
import { which } from "@/util/which"
import { Log } from "@/util/log"
import {
  CLI_BINARIES,
  CLI_PROVIDERS,
  OFFLINE_PROVIDERS,
  providerDialogCategory,
  providerDialogConnected,
  providerDialogProviders,
} from "./dialog-provider-options"

const OFFLINE_PROVIDER_HOSTS: Record<string, { envVar: string; defaultHost: string }> = {
  "ax-studio": { envVar: "AX_STUDIO_HOST", defaultHost: "http://localhost:18080" },
  ollama: { envVar: "OLLAMA_HOST", defaultHost: "http://localhost:11434" },
}

function offlineProviderHint() {
  return "not running"
}
const log = Log.create({ service: "tui.dialog-provider" })

function normalizeOfflineProviderBaseURL(input: string) {
  const trimmed = input.trim()
  if (!trimmed) throw new Error("Endpoint URL is required")
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  const url = new URL(withProtocol)
  const normalized = url.toString().replace(/\/+$/, "")
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`
}

function offlineProviderPreset(id: string, config: unknown) {
  const cfg = OFFLINE_PROVIDER_HOSTS[id]
  if (!cfg) return ""
  const providerConfig = (config as { provider?: Record<string, { options?: { baseURL?: string } }> } | undefined)
    ?.provider?.[id]
  return providerConfig?.options?.baseURL ?? process.env[cfg.envVar] ?? cfg.defaultHost
}

function runProviderDialogAction(input: {
  providerID: string
  action: string
  fallbackMessage: string
  toast: ReturnType<typeof useToast>
  run: () => Promise<void> | void
}) {
  void Promise.resolve()
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

export function createDialogProviderOptions() {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()
  const options = createMemo(() => {
    return pipe(
      providerDialogProviders({
        available: sync.data.provider_next.all,
        configured: sync.data.provider,
      }),
      map((provider) => {
        const isConnected = providerDialogConnected({
          providerID: provider.id,
          connected: sync.data.provider_next.connected,
          configured: sync.data.provider,
        })
        const isOfflineKind = OFFLINE_PROVIDERS.has(provider.id)
        return {
          title: provider.name,
          value: provider.id,
          description: isConnected ? "Connected" : isOfflineKind ? offlineProviderHint() : undefined,
          descriptionFg: isConnected ? theme.warning : isOfflineKind ? theme.textMuted : undefined,
          category: providerDialogCategory(provider.id),
          onSelect() {
            runProviderDialogAction({
              providerID: provider.id,
              action: "select-provider",
              fallbackMessage: `Failed to update ${provider.name}`,
              toast,
              run: async () => {
                const isConnected = providerDialogConnected({
                  providerID: provider.id,
                  connected: sync.data.provider_next.connected,
                  configured: sync.data.provider,
                })

                if (isOfflineKind) {
                  const saveEndpoint = async (value: string) => {
                    const baseURL = normalizeOfflineProviderBaseURL(value)
                    await sdk.client.config.update({
                      provider: {
                        [provider.id]: {
                          options: {
                            baseURL,
                          },
                        },
                      },
                    } as any)
                    await sdk.client.instance.dispose()
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
                        value={offlineProviderPreset(provider.id, sync.data.config)}
                        placeholder="http://localhost:1234"
                        description={() => (
                          <box gap={1}>
                            <text fg={theme.textMuted}>Press enter to use the preset, or edit the host and port.</text>
                            <text fg={theme.textMuted}>You can include /v1, but ax-code will add it if omitted.</text>
                          </box>
                        )}
                        onConfirm={(value) => {
                          if (!value) return
                          runProviderDialogAction({
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
                    const action = await new Promise<"use" | "endpoint" | null>((resolve) => {
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
                                description: offlineProviderPreset(provider.id, sync.data.config),
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
                          Install the CLI and ensure it is available in your PATH, then restart ax-code.
                        </text>
                      </box>
                    ))
                    return
                  }

                  if (isConnected) {
                    const action = await new Promise<"use" | "disconnect" | null>((resolve) => {
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
                      dialog.clear()
                    } else if (action === "disconnect") {
                      await sdk.client.auth.remove({ providerID: provider.id })
                      await sdk.client.instance.dispose()
                      await sync.bootstrap()
                      toast.show({ variant: "success", message: `Disconnected ${provider.name}` })
                      dialog.clear()
                    }
                  } else {
                    // Connect: store a marker in auth.json so provider persists as connected
                    await sdk.client.auth.set({
                      providerID: provider.id,
                      auth: { type: "api", key: "cli" },
                    })
                    await sdk.client.instance.dispose()
                    await sync.bootstrap()
                    toast.show({ variant: "success", message: `Connected ${provider.name}` })
                    dialog.clear()
                  }
                  return
                }

                // If provider already has a saved key, offer to use it or replace it
                if (isConnected) {
                  const action = await new Promise<"use" | "replace" | "remove" | null>((resolve) => {
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
                  if (action === "remove") {
                    await sdk.client.auth.remove({ providerID: provider.id })
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
                    if (!value) return
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
  return <DialogSelect title="Providers" options={options()} />
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
        .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
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
      if (cancelled) return
      if (result.error) {
        dialog.clear()
        return
      }
      await sdk.client.instance.dispose()
      if (cancelled) return
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
  const toast = useToast()
  const [error, setError] = createSignal(false)

  return (
    <DialogPrompt
      title={props.title}
      placeholder="Authorization code"
      onConfirm={(value) => {
        runProviderDialogAction({
          providerID: props.providerID,
          action: "oauth-code-confirm",
          fallbackMessage: "Failed to complete provider authorization",
          toast,
          run: async () => {
            const { error } = await sdk.client.provider.oauth.callback({
              providerID: props.providerID,
              method: props.index,
              code: value,
            })
            if (!error) {
              await sdk.client.instance.dispose()
              await sync.bootstrap()
              dialog.replace(() => <DialogModel providerID={props.providerID} />)
              return
            }
            setError(true)
          },
        })
      }}
      description={() => (
        <box gap={1}>
          <text fg={theme.textMuted}>{props.authorization.instructions}</text>
          <Link href={props.authorization.url} fg={theme.primary} />
          <Show when={error()}>
            <text fg={theme.error}>Invalid code</text>
          </Show>
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
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title={props.title}
      placeholder="API key"
      description={undefined}
      onConfirm={(value) => {
        if (!value) return
        runProviderDialogAction({
          providerID: props.providerID,
          action: "api-key-confirm",
          fallbackMessage: "Failed to connect provider",
          toast,
          run: async () => {
            await sdk.client.auth.set({
              providerID: props.providerID,
              auth: {
                type: "api",
                key: value,
              },
            })
            await sdk.client.instance.dispose()
            await sync.bootstrap()
            dialog.replace(() => <DialogModel providerID={props.providerID} />)
          },
        })
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
          <DialogPrompt title={prompt.message} placeholder={prompt.placeholder} onConfirm={(value) => resolve(value)} />
        ),
        () => resolve(null),
      )
    })
    if (value === null) return null
    inputs[prompt.key] = value
  }
  return inputs
}
