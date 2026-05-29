import z from "zod"

const emptyPayloadSchema = z.object({}).strict()

export const trustedAppOriginSchema = z
  .string()
  .refine((value) => isTrustedAppUrl(value), "sender must be a trusted desktop app origin")

export const bridgeCommandSchemas = {
  "platform.capabilities": emptyPayloadSchema,
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
      baseUrl: z.string().url(),
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

export type ParsedBridgeCommand<TName extends BridgeCommandName = BridgeCommandName> = {
  name: TName
  payload: BridgeCommandPayload<TName>
}

export function parseBridgeCommand<TName extends BridgeCommandName>(
  name: TName,
  payload: unknown,
): ParsedBridgeCommand<TName> {
  return {
    name,
    payload: bridgeCommandSchemas[name].parse(payload) as BridgeCommandPayload<TName>,
  }
}

export function validateBridgeSender(sender: BridgeSender) {
  const primary = trustedAppOriginSchema.safeParse(sender.url)
  if (!primary.success) return false
  if (!sender.frameUrl) return true
  return trustedAppOriginSchema.safeParse(sender.frameUrl).success
}

export function assertBridgeSender(sender: BridgeSender) {
  if (!validateBridgeSender(sender)) {
    throw new Error(`Untrusted desktop bridge sender: ${sender.frameUrl ?? sender.url}`)
  }
}

export function isTrustedAppUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (url.protocol === "app:" && url.hostname === "ax-code") return true
  if (url.protocol !== "http:") return false
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return true
  return false
}
