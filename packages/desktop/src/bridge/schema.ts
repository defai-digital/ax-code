import z from "zod"

const emptyPayloadSchema = z.object({}).strict()

export const trustedAppOriginSchema = z
  .string()
  .refine((value) => isTrustedAppUrl(value), "sender must be a trusted desktop app origin")

export const bridgeCommandSchemas = {
  "platform.capabilities": emptyPayloadSchema,
  "release.checkUpdate": emptyPayloadSchema,
  "release.downloadUpdate": emptyPayloadSchema,
  "release.openDownloadedUpdate": z
    .object({
      artifactPath: z.string().min(1).max(4096),
    })
    .strict(),
  "external.open": z
    .object({
      url: z
        .string()
        .url()
        .refine((value) => {
          const protocol = new URL(value).protocol
          return protocol === "https:" || protocol === "http:"
        }, "url must use http or https"),
    })
    .strict(),
  "dialog.chooseDirectory": z
    .object({
      title: z.string().min(1).max(120).optional(),
    })
    .strict(),
  "path.reveal": z
    .object({
      path: z.string().min(1).max(4096),
    })
    .strict(),
  "editor.open": z
    .object({
      path: z.string().min(1).max(4096),
      line: z.number().int().min(1).max(1_000_000).optional(),
      column: z.number().int().min(1).max(1_000_000).optional(),
    })
    .strict(),
  "notification.show": z
    .object({
      title: z.string().min(1).max(120),
      body: z.string().max(500).optional(),
      source: z.enum(["scheduled-task"]).optional(),
      silent: z.boolean().optional(),
    })
    .strict(),
  "diagnostics.exportLogs": z
    .object({
      includeBackendLogs: z.boolean().default(true),
    })
    .strict(),
  "diagnostics.read": emptyPayloadSchema,
  "app.config": emptyPayloadSchema,
  "backend.attach": z
    .object({
      baseUrl: z.string().url().refine(isLoopbackHttpUrl, "baseUrl must be an http(s) loopback URL"),
      authHeader: z.string().min(1).optional(),
    })
    .strict(),
  "backend.start": z
    .object({
      directory: z.string().min(1),
      port: z.number().int().min(0).max(65535).optional(),
    })
    .strict(),
} as const

export type BridgeCommandName = keyof typeof bridgeCommandSchemas
export type BridgeCommandPayload<TName extends BridgeCommandName> = z.infer<(typeof bridgeCommandSchemas)[TName]>

export type BridgeSender = {
  url: string
  frameUrl?: string
}

export type BridgeSenderValidationOptions = {
  trustedOrigins?: readonly string[]
}

export type ParsedBridgeCommand<TName extends BridgeCommandName = BridgeCommandName> = {
  name: TName
  payload: BridgeCommandPayload<TName>
}

export function parseBridgeCommand<TName extends BridgeCommandName>(name: TName, payload: unknown): ParsedBridgeCommand<TName>
export function parseBridgeCommand(name: string, payload: unknown): ParsedBridgeCommand
export function parseBridgeCommand(name: string, payload: unknown): ParsedBridgeCommand {
  if (!isBridgeCommandName(name)) throw new Error(`Unsupported desktop bridge command: ${name}`)
  return {
    name,
    payload: bridgeCommandSchemas[name].parse(payload) as BridgeCommandPayload<BridgeCommandName>,
  }
}

export function isBridgeCommandName(name: string): name is BridgeCommandName {
  return Object.prototype.hasOwnProperty.call(bridgeCommandSchemas, name)
}

export function validateBridgeSender(sender: BridgeSender, options: BridgeSenderValidationOptions = {}) {
  if (!isTrustedAppUrl(sender.url, options.trustedOrigins)) return false
  if (!sender.frameUrl) return true
  return isSameBridgeDocument(sender.url, sender.frameUrl)
}

export function assertBridgeSender(sender: BridgeSender, options: BridgeSenderValidationOptions = {}) {
  if (!validateBridgeSender(sender, options)) {
    throw new Error(`Untrusted desktop bridge sender: ${sender.frameUrl ?? sender.url}`)
  }
}

export function isTrustedAppUrl(value: string, trustedOrigins: readonly string[] = []) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (url.protocol === "app:" && url.hostname === "ax-code") return true
  if (trustedOrigins.length === 0) return false
  if (url.protocol !== "http:" && url.protocol !== "https:") return false
  if (trustedOrigins.some((origin) => sameOrigin(url, origin))) return true
  return false
}

function sameOrigin(url: URL, origin: string) {
  try {
    return url.origin === new URL(origin).origin
  } catch {
    return false
  }
}

function isSameBridgeDocument(primaryUrl: string, frameUrl: string) {
  let primary: URL
  let frame: URL
  try {
    primary = new URL(primaryUrl)
    frame = new URL(frameUrl)
  } catch {
    return false
  }

  return (
    primary.protocol === frame.protocol &&
    primary.host === frame.host &&
    primary.pathname === frame.pathname &&
    primary.search === frame.search
  )
}

function isLoopbackHttpUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false
  return (
    url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]" || url.hostname === "::1"
  )
}
