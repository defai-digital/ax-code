import z from "zod"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import type { DialogContext } from "@tui/ui/dialog"
import type { useSDK } from "@tui/context/sdk"
import type { useTheme } from "@tui/context/theme"
import { directoryRequestHeaders } from "@tui/util/request-headers"
import { urlAllowlistServerRoute } from "@tui/util/server-url"
import { isRecord } from "@/util/record"

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
    return (
      previous.get(id) ?? {
        id,
        name: id,
        contextWindow: 128_000,
        outputLimit: 16_384,
        toolCall: true,
        reasoning: false,
        attachment: false,
        temperature: true,
      }
    )
  })
}

function chooseProtocol(input: {
  dialog: DialogContext
  current: CustomApiProviderProtocol
}): Promise<CustomApiProviderProtocol | null> {
  return new Promise((resolve) => {
    input.dialog.replace(
      () => (
        <DialogSelect
          title="API protocol"
          current={input.current}
          options={[
            {
              title: "OpenAI-compatible",
              value: "openai-compatible" as const,
              description: "Chat Completions compatible endpoint",
            },
            {
              title: "Anthropic-compatible",
              value: "anthropic-compatible" as const,
              description: "Anthropic Messages compatible endpoint",
            },
          ]}
          onSelect={(option) => resolve(option.value)}
        />
      ),
      () => resolve(null),
    )
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

export async function configureCustomApiProvider(input: {
  dialog: DialogContext
  sdk: SDK
  theme: Theme
  existing?: CustomApiProviderView
}): Promise<CustomApiProviderView | null> {
  const name = await DialogPrompt.show(input.dialog, "Provider name", {
    value: input.existing?.name ?? "",
    placeholder: "Company gateway",
  })
  if (name === null) return null

  const providerID = input.existing
    ? input.existing.providerID
    : await DialogPrompt.show(input.dialog, "Provider ID", {
        placeholder: "company-gateway",
        description: () => (
          <text fg={input.theme.textMuted}>Lowercase letters, numbers, dots, underscores, and hyphens.</text>
        ),
      })
  if (providerID === null) return null

  const protocol = await chooseProtocol({
    dialog: input.dialog,
    current: input.existing?.protocol ?? "openai-compatible",
  })
  if (protocol === null) return null

  const baseURL = await DialogPrompt.show(input.dialog, "Base URL", {
    value: input.existing?.baseURL ?? "",
    placeholder: "https://api.example.com/v1",
  })
  if (baseURL === null) return null
  const allowInsecureHttp = await confirmInsecureHttp(input.dialog, baseURL.trim())
  if (!allowInsecureHttp) return null

  const apiKey = await DialogPrompt.show(input.dialog, "API token", {
    value: "",
    placeholder: input.existing?.hasApiKey ? "Leave blank to keep saved token" : "Optional token",
    description: () => (
      <box gap={1}>
        <text fg={input.theme.textMuted}>The token is visible while typing in this TUI prompt.</text>
        <text fg={input.theme.textMuted}>It is encrypted in AX Code auth storage and never returned.</text>
      </box>
    ),
  })
  if (apiKey === null) return null

  const modelIDs = await DialogPrompt.show(input.dialog, "Model IDs", {
    value: input.existing?.models.map((model) => model.id).join(", ") ?? "",
    placeholder: "model-a, model-b",
    description: () => (
      <box gap={1}>
        <text fg={input.theme.textMuted}>Comma- or newline-separated IDs. New models default to 128k context.</text>
        <text fg={input.theme.textMuted}>Use Desktop to edit per-model limits and capabilities.</text>
      </box>
    ),
  })
  if (modelIDs === null) return null
  const models = parseCustomApiProviderModelIDs(modelIDs, input.existing?.models)

  const body = {
    name: name.trim(),
    protocol,
    baseURL: baseURL.trim(),
    allowInsecureHttp: new URL(baseURL.trim()).protocol === "http:",
    ...(apiKey.length > 0 ? { apiKey } : {}),
    models,
  }
  return View.parse(
    await customProviderRequest(input.sdk, `/provider/custom/${encodeURIComponent(providerID.trim())}`, {
      method: "PUT",
      body,
    }),
  )
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
