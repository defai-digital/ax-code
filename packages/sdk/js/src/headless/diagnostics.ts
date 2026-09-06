import { z } from "zod"

/** Zod schema for headless event-stream health. */
export const HeadlessStreamHealthSchema = z.enum(["fixture", "connecting", "connected", "unavailable", "error"])
/** Inferred stream-health value (`fixture`, `connecting`, `connected`, `unavailable`, `error`). */
export type HeadlessStreamHealthValue = z.infer<typeof HeadlessStreamHealthSchema>

/** Zod schema for a structured app-error envelope. */
export const AppErrorEnvelopeSchema = z
  .object({
    name: z.string(),
    message: z.string(),
    status: z.number().int().min(400).max(599),
    code: z.string().optional(),
    logRef: z.string().optional(),
    retryable: z.boolean().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
/** Structured app-error envelope used in diagnostic exports. */
export type AppErrorEnvelopeLike = z.infer<typeof AppErrorEnvelopeSchema>

/** Zod schema for a redacted desktop diagnostic export. */
export const DesktopDiagnosticExportSchema = z
  .object({
    appVersion: z.string(),
    platform: z.string(),
    backendMode: z.enum(["sidecar", "attached"]),
    backendHealth: z.enum(["unknown", "starting", "healthy", "unavailable"]),
    streamHealth: HeadlessStreamHealthSchema,
    logRefs: z.array(z.string()),
    recentErrors: z.array(AppErrorEnvelopeSchema),
  })
  .strict()
/** Redacted diagnostic snapshot an app shell can export for support. */
export type DesktopDiagnosticExport = z.infer<typeof DesktopDiagnosticExportSchema>

const SENSITIVE_KEY = /(?:token|secret|password|api[_-]?key|authorization|authheader|providerkey|backendpassword)/i
const REDACTED = "[REDACTED]"

/** Parse and redact an unknown value as a desktop diagnostic export. */
export function parseDesktopDiagnosticExport(input: unknown): DesktopDiagnosticExport {
  return DesktopDiagnosticExportSchema.parse(redactDiagnosticValue(input))
}

/** Recursively redact credential-like keys from a diagnostic value. */
export function redactDiagnosticValue(input: unknown): unknown {
  if (!input || typeof input !== "object") return input
  if (Array.isArray(input)) return input.map((item) => redactDiagnosticValue(item))
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([key, value]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : redactDiagnosticValue(value),
    ]),
  )
}
