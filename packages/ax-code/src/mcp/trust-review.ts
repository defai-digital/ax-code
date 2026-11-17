import z from "zod/v4"
import { maskedCredentialValue } from "@/util/credential-value"
import type { Config } from "../config/config"
import { WebMcpProfile } from "./webmcp-profile"

/**
 * ADR-255: what trusting a needs_trust server would run. Argument values that
 * look like credentials, URL userinfo and query values, and environment and
 * header values are never included; `redacted` says something was hidden.
 */
export const TrustReview = z
  .discriminatedUnion("transport", [
    z.object({
      transport: z.literal("local"),
      command: z.string().array().optional(),
      environmentKeys: z.string().array().optional(),
      webmcp: z
        .object({
          allowedOrigins: z.string().array(),
          executablePath: z.string().optional(),
          persistentProfile: z.boolean().optional(),
          vendored: z.boolean().optional(),
          headless: z.boolean().optional(),
          read: z.boolean().optional(),
          interact: z.boolean().optional(),
        })
        .optional(),
      redacted: z.boolean().optional(),
    }),
    z.object({
      transport: z.literal("remote"),
      url: z.string().optional(),
      hasCredentials: z.boolean().optional(),
      queryKeys: z.string().array().optional(),
      headerKeys: z.string().array().optional(),
    }),
  ])
  .meta({ ref: "MCPTrustReview" })
export type TrustReview = z.infer<typeof TrustReview>

const SENSITIVE_ARG_NAME =
  /token|secret|passw|pwd|api[-_]?key|apikey|auth|credential|bearer|cookie|session|private[-_]?key|dsn/i
const REDACTED = "[redacted]"

/** A URL-shaped argument without userinfo or query values; null when the argument is not a URL. */
function redactUrlArgument(value: string): { text: string; changed: boolean } | null {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return null
  try {
    const parsed = new URL(value)
    const hadSecrets = Boolean(parsed.username || parsed.password || parsed.search || parsed.hash)
    const keys = [...new Set([...parsed.searchParams.keys()])]
    const query = keys.length > 0 ? `?${keys.map((key) => `${key}=${REDACTED}`).join("&")}` : ""
    const auth = parsed.username || parsed.password ? `${REDACTED}@` : ""
    return { text: `${parsed.protocol}//${auth}${parsed.host}${parsed.pathname}${query}`, changed: hadSecrets }
  } catch {
    return { text: REDACTED, changed: true }
  }
}

/**
 * Argv for review: flag values whose name looks secret, credential-shaped
 * values and URL userinfo or query values are replaced. The fingerprint
 * still binds the real argv, so trust covers exactly what will run.
 */
export function redactArgv(argv: readonly string[]): { argv: string[]; redacted: boolean } {
  const out: string[] = []
  let redacted = false
  let hideNext = false
  for (const arg of argv) {
    if (hideNext) {
      hideNext = false
      out.push(REDACTED)
      redacted = true
      continue
    }
    const eq = arg.indexOf("=")
    if (arg.startsWith("-") && eq > 0) {
      const name = arg.slice(0, eq)
      const value = arg.slice(eq + 1)
      if (SENSITIVE_ARG_NAME.test(name) || maskedCredentialValue(value)) {
        out.push(`${name}=${REDACTED}`)
        redacted = true
        continue
      }
      const url = redactUrlArgument(value)
      if (url) {
        out.push(`${name}=${url.text}`)
        redacted ||= url.changed
        continue
      }
      out.push(arg)
      continue
    }
    if (arg.startsWith("-") && SENSITIVE_ARG_NAME.test(arg)) {
      out.push(arg)
      hideNext = true
      continue
    }
    if (maskedCredentialValue(arg)) {
      out.push(REDACTED)
      redacted = true
      continue
    }
    const url = redactUrlArgument(arg)
    if (url) {
      out.push(url.text)
      redacted ||= url.changed
      continue
    }
    out.push(arg)
  }
  return { argv: out, redacted }
}

/** ADR-255: the review a client shows before trusting. */
export function trustReview(mcp: Config.Mcp): TrustReview {
  if (mcp.type === "remote") {
    try {
      const parsed = new URL(mcp.url)
      const queryKeys = [...new Set([...parsed.searchParams.keys()])].sort()
      const headerKeys = Object.keys(mcp.headers ?? {}).sort()
      return {
        transport: "remote",
        url: `${parsed.origin}${parsed.pathname}`,
        ...(parsed.username || parsed.password ? { hasCredentials: true } : {}),
        ...(queryKeys.length > 0 ? { queryKeys } : {}),
        ...(headerKeys.length > 0 ? { headerKeys } : {}),
      }
    } catch {
      // Never fall back to the raw value: it may carry credentials.
      return { transport: "remote" }
    }
  }
  const environmentKeys = Object.keys(mcp.environment ?? {}).sort()
  const env = environmentKeys.length > 0 ? { environmentKeys } : {}
  if (mcp.webmcp) {
    // ADR-173: a WebMCP entry's stored command is never executed; the argv is
    // regenerated from the profile, so the review shows the profile and that argv.
    const profile = mcp.webmcp
    let argv: string[] | undefined
    try {
      argv = WebMcpProfile.command(profile, profile)
    } catch {
      argv = undefined
    }
    const shown = argv ? redactArgv(argv) : undefined
    return {
      transport: "local",
      ...(shown ? { command: shown.argv } : {}),
      ...env,
      webmcp: {
        allowedOrigins: [...(profile.allowedOrigins ?? [])],
        ...(profile.executablePath ? { executablePath: profile.executablePath } : {}),
        ...(profile.persistentProfile !== undefined ? { persistentProfile: profile.persistentProfile } : {}),
        ...(profile.vendored !== undefined ? { vendored: profile.vendored } : {}),
        ...(profile.headless !== undefined ? { headless: profile.headless } : {}),
        ...(profile.read !== undefined ? { read: profile.read } : {}),
        ...(profile.interact !== undefined ? { interact: profile.interact } : {}),
      },
      ...(shown?.redacted ? { redacted: true } : {}),
    }
  }
  const shown = redactArgv(mcp.command)
  return { transport: "local", command: shown.argv, ...env, ...(shown.redacted ? { redacted: true } : {}) }
}
