import { createMemo, createSignal, onMount, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { filter, map, pipe, sortBy } from "remeda"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "../context/sdk"
import { DialogPrompt } from "../ui/dialog-prompt"
import { Link } from "../ui/link"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@tui/renderer-adapter/opentui"
import type { ProviderAuthAuthorization, ProviderAuthMethod } from "@ax-code/sdk/v2"
import { DialogModel } from "./dialog-model"
import { useKeyboard } from "@tui/renderer-adapter/opentui"
import { Clipboard } from "@tui/util/clipboard"
import { useToast } from "../ui/toast"
import { resolveCliModel } from "@/provider/cli/resolve"
import { which } from "@/util/which"

const CLI_BINARIES: Record<string, string> = {
  "claude-code": "claude",
  "gemini-cli": "gemini",
  "codex-cli": "codex",
}

const OFFLINE_PROVIDERS = new Set(["ax-serving", "ollama", "lmstudio"])
const CLI_PROVIDERS = new Set(["claude-code", "gemini-cli", "codex-cli"])
const HIDDEN_PROVIDERS = new Set(["google", "github-copilot", "alibaba"])

export function createDialogProviderOptions() {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()
  const options = createMemo(() => {
    return pipe(
      sync.data.provider_next.all,
      filter((x) => !HIDDEN_PROVIDERS.has(x.id)),
      sortBy((x) => (OFFLINE_PROVIDERS.has(x.id) ? 0 : CLI_PROVIDERS.has(x.id) ? 1 : 2), (x) => x.name),
      map((provider) => ({
        title: provider.name,
        value: provider.id,
        description: sync.data.provider_next.connected.includes(provider.id) ? "Connected" : undefined,
        descriptionFg: sync.data.provider_next.connected.includes(provider.id) ? theme.warning : undefined,
        category: OFFLINE_PROVIDERS.has(provider.id) ? "Offline" : CLI_PROVIDERS.has(provider.id) ? "Online - CLI" : "Online",
        async onSelect() {
          const isConnected = sync.data.provider_next.connected.includes(provider.id)

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

            const info = await resolveCliModel(provider.id)

            if (isConnected) {
              const action = await new Promise<"use" | "disconnect" | null>((resolve) => {
                dialog.replace(
                  () => (
                    <DialogSelect
                      title={`${provider.name} — connected`}
                      options={[
                        {
                          title: "Select a model",
                          value: "use" as const,
                          description: `Current: ${info.model}`,
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
                dialog.replace(() => <DialogModel providerID={provider.id} />)
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
              dialog.replace(() => <DialogModel providerID={provider.id} />)
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
                <CodeMethod providerID={provider.id} title={method.label} index={index} authorization={authorization} />
              ))
            }
            if (authorization.method === "auto") {
              dialog.replace(() => (
                <AutoMethod providerID={provider.id} title={method.label} index={index} authorization={authorization} />
              ))
            }
          }
          if (method.type === "api") {
            return dialog.replace(() => <ApiMethod providerID={provider.id} title={method.label} />)
          }
        },
      })),
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

  onMount(async () => {
    const result = await sdk.client.provider.oauth.callback({
      providerID: props.providerID,
      method: props.index,
    })
    if (result.error) {
      dialog.clear()
      return
    }
    await sdk.client.instance.dispose()
    await sync.bootstrap()
    dialog.replace(() => <DialogModel providerID={props.providerID} />)
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
  const [error, setError] = createSignal(false)

  return (
    <DialogPrompt
      title={props.title}
      placeholder="Authorization code"
      onConfirm={async (value) => {
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
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title={props.title}
      placeholder="API key"
      description={
        undefined
      }
      onConfirm={async (value) => {
        if (!value) return
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
