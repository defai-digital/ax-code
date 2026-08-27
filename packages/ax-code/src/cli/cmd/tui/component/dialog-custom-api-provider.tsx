import z from "zod"
import { TextareaRenderable, TextAttributes } from "@ax-code/tui"
import { createSignal, onCleanup, onMount } from "solid-js"
import { useKeyboard } from "@ax-code/tui/solid"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import type { useSDK } from "@tui/context/sdk"
import { useTheme } from "@tui/context/theme"
import { directoryRequestHeaders } from "@tui/util/request-headers"
import { urlAllowlistServerRoute } from "@tui/util/server-url"
import { scheduleMicrotaskTask } from "@tui/util/microtask"
import { focusRenderable } from "@tui/util/renderable-safety"
import { isRecord } from "@/util/record"
import { CustomApiProvider } from "@/provider/custom-api-provider"

const Protocol = z.enum(["openai-compatible", "anthropic-compatible"])
export type CustomApiProviderProtocol = z.infer<typeof Protocol>

const Model = z.object({
  id: z.string(),
  name: z.string().optional(),
  contextWindow: z.number(),
  outputLimit: z.number(),
  toolCall: z.boolean(),
  reasoning: z.boolean(),
  attachment: z.boolean(),
  temperature: z.boolean(),
})
export type CustomApiProviderModel = z.infer<typeof Model>

const View = z.object({
  providerID: z.string(),
  name: z.string(),
  protocol: Protocol,
  baseURL: z.string(),
  hasApiKey: z.boolean(),
  models: z.array(Model),
})
export type CustomApiProviderView = z.infer<typeof View>

type SDK = ReturnType<typeof useSDK>
type Theme = ReturnType<typeof useTheme>["theme"]

async function responsePayload(response: Response) {
  return response.json().catch(() => undefined)
}

function responseError(payload: unknown, fallback: string) {
  if (!isRecord(payload)) return fallback
  if (typeof payload.message === "string") return payload.message
  if (isRecord(payload.data) && typeof payload.data.message === "string") return payload.data.message
  return fallback
}

async function customProviderRequest(
  sdk: SDK,
  path: string,
  init: { method: "GET" | "PUT" | "DELETE"; body?: unknown },
) {
  const response = await sdk.fetch(urlAllowlistServerRoute(sdk.url, path), {
    method: init.method,
    headers: directoryRequestHeaders({
      directory: sdk.directory,
      contentType: init.body === undefined ? undefined : "application/json",
    }),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const payload = await responsePayload(response)
  if (!response.ok)
    throw new Error(responseError(payload, `Custom provider request failed with HTTP ${response.status}`))
  return payload
}

export async function listCustomApiProviders(sdk: SDK): Promise<CustomApiProviderView[]> {
  return z.array(View).parse(await customProviderRequest(sdk, "/provider/custom", { method: "GET" }))
}

export async function deleteCustomApiProvider(sdk: SDK, providerID: string): Promise<void> {
  const removed = z
    .boolean()
    .parse(await customProviderRequest(sdk, `/provider/custom/${encodeURIComponent(providerID)}`, { method: "DELETE" }))
  if (!removed) throw new Error(`Managed custom provider ${providerID} no longer exists`)
}

export function isManagedCustomApiProviderConfig(config: unknown, providerID: string): boolean {
  if (!isRecord(config) || !isRecord(config.provider)) return false
  const provider = config.provider[providerID]
  return isRecord(provider) && provider.management === "custom-api"
}

export function parseCustomApiProviderModelIDs(
  value: string,
  existing: readonly CustomApiProviderModel[] = [],
): CustomApiProviderModel[] {
  const ids = value
    .split(/[\n,]/u)
    .map((item) => item.trim())
    .filter(Boolean)
  if (ids.length === 0) throw new Error("At least one model ID is required")
  if (ids.length > 128) throw new Error("A custom provider can declare at most 128 models")
  const seen = new Set<string>()
  const previous = new Map(existing.map((model) => [model.id, model]))
  return ids.map((id) => {
    if (id.length > 256 || /\s/u.test(id)) throw new Error(`Invalid model ID: ${id}`)
    if (seen.has(id)) throw new Error(`Duplicate model ID: ${id}`)
    seen.add(id)
    return previous.get(id) ?? CustomApiProvider.discoveredModel(id)
  })
}

async function confirmInsecureHttp(dialog: DialogContext, baseURL: string) {
  let url: URL
  try {
    url = new URL(baseURL)
  } catch {
    throw new Error("Base URL must be a valid HTTP(S) URL")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Base URL must use HTTP or HTTPS")
  if (url.username || url.password) throw new Error("Base URL must not contain credentials")
  if (url.search || url.hash) throw new Error("Base URL must not contain a query string or fragment")
  const hostname = url.hostname.toLowerCase()
  const loopback =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  if (url.protocol !== "http:" || loopback) return true
  return new Promise<boolean>((resolve) => {
    dialog.replace(
      () => (
        <DialogSelect
          title="Allow insecure HTTP?"
          options={[
            { title: "Cancel", value: false, description: "Use HTTPS instead" },
            {
              title: "Allow HTTP",
              value: true,
              description: "Only continue when this network is trusted",
            },
          ]}
          onSelect={(option) => resolve(option.value)}
        />
      ),
      () => resolve(false),
    )
  })
}

type CustomApiConnectFields = {
  baseURL: string
  apiKey: string
}

function DialogCustomApiConnect(props: {
  existing?: CustomApiProviderView
  onConfirm: (fields: CustomApiConnectFields) => void
}) {
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()
  const [active, setActive] = createSignal<"baseURL" | "apiKey">("baseURL")
  let baseURLInput: TextareaRenderable
  let apiKeyInput: TextareaRenderable

  const focusActive = () => {
    const target = active() === "baseURL" ? baseURLInput : apiKeyInput
    focusRenderable(target, { name: "custom-api-connect-focus" })
    target?.gotoLineEnd()
  }

  const submit = () => {
    const baseURL = (baseURLInput?.plainText ?? "").trim()
    const apiKey = apiKeyInput?.plainText ?? ""
    if (!baseURL) {
      toast.show({ message: "Base URL is required", variant: "error" })
      setActive("baseURL")
      focusActive()
      return
    }
    if (!apiKey.trim() && !props.existing?.hasApiKey) {
      toast.show({ message: "API token is required", variant: "error" })
      setActive("apiKey")
      focusActive()
      return
    }
    props.onConfirm({ baseURL, apiKey })
  }

  useKeyboard((evt) => {
    if (evt.name === "tab") {
      evt.preventDefault()
      setActive((current) => (current === "baseURL" ? "apiKey" : "baseURL"))
      scheduleMicrotaskTask(focusActive, { name: "custom-api-connect-tab" })
      return
    }
    if (evt.name === "return") {
      evt.preventDefault()
      evt.stopPropagation()
      if (active() === "baseURL") {
        setActive("apiKey")
        scheduleMicrotaskTask(focusActive, { name: "custom-api-connect-next" })
        return
      }
      submit()
    }
  })

  onMount(() => {
    dialog.setSize("medium")
    const cancel = scheduleMicrotaskTask(focusActive, { name: "custom-api-connect-focus" })
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
          {props.existing ? `Update ${props.existing.name}` : "Custom API provider"}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box gap={1}>
        <text fg={theme.textMuted}>OpenAI-compatible base URL and bearer token. Models load from GET /models.</text>
        {fieldLabel("baseURL", "1. Base URL")}
        <textarea
          height={3}
          keyBindings={[{ name: "return", action: "submit" }]}
          ref={(val: TextareaRenderable) => (baseURLInput = val)}
          initialValue={props.existing?.baseURL ?? ""}
          placeholder="https://api.example.com/v1"
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
        />
        {fieldLabel("apiKey", "2. API token")}
        <textarea
          height={3}
          keyBindings={[{ name: "return", action: "submit" }]}
          ref={(val: TextareaRenderable) => (apiKeyInput = val)}
          initialValue=""
          placeholder={props.existing?.hasApiKey ? "Leave blank to keep saved token" : "Bearer token"}
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

async function allocateProviderID(sdk: SDK, base: string): Promise<string> {
  const existing = await listCustomApiProviders(sdk)
  const used = new Set(existing.map((provider) => provider.providerID))
  if (!used.has(base)) return base
  for (let index = 2; index < 100; index++) {
    const candidate = `${base.slice(0, 60)}-${index}`.slice(0, 63)
    if (!used.has(candidate)) return candidate
  }
  throw new Error("Could not allocate a provider ID")
}

export async function configureCustomApiProvider(input: {
  dialog: DialogContext
  sdk: SDK
  theme: Theme
  existing?: CustomApiProviderView
}): Promise<CustomApiProviderView | null> {
  const fields = await new Promise<CustomApiConnectFields | null>((resolve) => {
    input.dialog.replace(
      () => <DialogCustomApiConnect existing={input.existing} onConfirm={(value) => resolve(value)} />,
      () => resolve(null),
    )
  })
  if (!fields) return null
  const allowInsecureHttp = await confirmInsecureHttp(input.dialog, fields.baseURL)
  if (!allowInsecureHttp) return null

  const identity = input.existing
    ? { name: input.existing.name, providerID: input.existing.providerID }
    : CustomApiProvider.identityFromBaseURL(fields.baseURL)
  const providerID = input.existing ? identity.providerID : await allocateProviderID(input.sdk, identity.providerID)
  const body: Record<string, unknown> = {
    name: identity.name,
    protocol: input.existing?.protocol ?? "openai-compatible",
    baseURL: fields.baseURL,
    allowInsecureHttp: new URL(fields.baseURL).protocol === "http:",
    ...(fields.apiKey.trim().length > 0 ? { apiKey: fields.apiKey } : {}),
  }
  if (input.existing && input.existing.baseURL === fields.baseURL && input.existing.models.length > 0) {
    body.models = input.existing.models
  }

  try {
    return View.parse(
      await customProviderRequest(input.sdk, `/provider/custom/${encodeURIComponent(providerID)}`, {
        method: "PUT",
        body,
      }),
    )
  } catch (error) {
    const modelIDs = await DialogPrompt.show(input.dialog, "Model IDs", {
      value: input.existing?.models.map((model) => model.id).join(", ") ?? "",
      placeholder: "model-a, model-b",
      description: () => (
        <box gap={1}>
          <text fg={input.theme.textMuted}>
            {error instanceof Error ? error.message : "Could not load models from GET /models."}
          </text>
          <text fg={input.theme.textMuted}>Comma- or newline-separated IDs. New models default to 128k context.</text>
        </box>
      ),
    })
    if (modelIDs === null) return null
    return View.parse(
      await customProviderRequest(input.sdk, `/provider/custom/${encodeURIComponent(providerID)}`, {
        method: "PUT",
        body: {
          ...body,
          models: parseCustomApiProviderModelIDs(modelIDs, input.existing?.models),
        },
      }),
    )
  }
}

export function customApiProviderManagementMenu(input: {
  dialog: DialogContext
  provider: CustomApiProviderView
}): Promise<"use" | "update" | "delete" | null> {
  return new Promise((resolve) => {
    input.dialog.replace(
      () => (
        <DialogSelect
          title={`${input.provider.name} — custom API`}
          options={[
            { title: "Select a model", value: "use" as const },
            { title: "Update provider", value: "update" as const, description: input.provider.baseURL },
            {
              title: "Delete provider",
              value: "delete" as const,
              description: "Remove endpoint metadata and encrypted token",
            },
          ]}
          onSelect={(option) => resolve(option.value)}
        />
      ),
      () => resolve(null),
    )
  })
}

export function confirmCustomApiProviderDelete(input: {
  dialog: DialogContext
  provider: CustomApiProviderView
}): Promise<boolean> {
  return new Promise((resolve) => {
    input.dialog.replace(
      () => (
        <DialogSelect
          title={`Delete ${input.provider.name}?`}
          options={[
            { title: "Cancel", value: false },
            { title: "Delete", value: true, description: "This also removes the saved token" },
          ]}
          onSelect={(option) => resolve(option.value)}
        />
      ),
      () => resolve(false),
    )
  })
}
