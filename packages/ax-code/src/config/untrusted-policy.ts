import path from "node:path"
import { isRecord } from "../util/record"
import { Ssrf } from "../util/ssrf"
import type { Info } from "./schema"

function denyOnlyPermission(value: unknown): unknown {
  if (value === "deny") return value
  if (!isRecord(value)) return undefined
  const result: Record<string, unknown> = {}
  for (const [permission, rule] of Object.entries(value)) {
    if (rule === "deny") {
      result[permission] = rule
      continue
    }
    if (!isRecord(rule)) continue
    const patterns = Object.fromEntries(Object.entries(rule).filter(([, action]) => action === "deny"))
    if (Object.keys(patterns).length > 0) result[permission] = patterns
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function denyOnlyLegacyTools(value: unknown): unknown {
  if (!isRecord(value)) return undefined
  const result = Object.fromEntries(Object.entries(value).filter(([, enabled]) => enabled === false))
  return Object.keys(result).length > 0 ? result : undefined
}

function retainDenials(copy: Record<string, unknown>): void {
  const permission = denyOnlyPermission(copy.permission)
  if (permission) copy.permission = permission
  else delete copy.permission
  const tools = denyOnlyLegacyTools(copy.tools)
  if (tools) copy.tools = tools
  else delete copy.tools
}

export function restrictUntrustedAgent(value: unknown): unknown {
  if (!isRecord(value)) return value
  const agent = { ...value }
  retainDenials(agent)
  return agent
}

function isSafeProjectRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false
  if (path.isAbsolute(value) || path.win32.isAbsolute(value) || value.startsWith("~")) return false
  try {
    if (new URL(value).protocol) return false
  } catch {}
  return !value.split(/[\\/]+/).includes("..")
}

function restrictUntrustedProviders(value: unknown): unknown {
  if (!isRecord(value)) return undefined
  return Object.fromEntries(
    Object.entries(value).map(([name, providerValue]) => {
      if (!isRecord(providerValue)) return [name, providerValue]
      const provider = { ...providerValue }
      delete provider.api
      delete provider.npm
      delete provider.env
      delete provider.management
      if (isRecord(provider.options)) {
        provider.options = Object.fromEntries(
          Object.entries(provider.options).filter(([key]) =>
            ["timeout", "chunkTimeout", "setCacheKey", "toolProfile"].includes(key),
          ),
        )
      }
      if (isRecord(provider.models)) {
        provider.models = Object.fromEntries(
          Object.entries(provider.models).map(([modelID, modelValue]) => {
            if (!isRecord(modelValue)) return [modelID, modelValue]
            const model = { ...modelValue }
            delete model.provider
            return [modelID, model]
          }),
        )
      }
      return [name, provider]
    }),
  )
}

/** Restrict repository/remote input without mutating the caller's config. */
export function restrictUntrustedConfig(value: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...value }
  // Untrusted sources can retain denials but cannot grant tool access.
  retainDenials(copy)
  for (const key of ["agent", "mode"] as const) {
    const entries = copy[key]
    if (!isRecord(entries)) continue
    copy[key] = Object.fromEntries(
      Object.entries(entries).map(([name, entry]) => [name, restrictUntrustedAgent(entry)]),
    )
  }
  delete copy.code_mode
  delete copy.mcp_sampling
  // Granting a plugin session administration is a user decision, never a repository one.
  delete copy.plugin_trust
  // These fields can execute a repository-selected binary, import a package,
  // redirect provider credentials, or read arbitrary files from the user's
  // home directory. Project config may use them only after the explicit
  // out-of-repository trust opt-in.
  delete copy.shell
  delete copy.skills
  const provider = restrictUntrustedProviders(copy.provider)
  if (provider) copy.provider = provider
  else delete copy.provider

  if (Array.isArray(copy.instructions)) {
    const instructions = copy.instructions.filter(isSafeProjectRelativePath)
    if (instructions.length > 0) copy.instructions = instructions
    else delete copy.instructions
  }

  if (isRecord(copy.command)) {
    copy.command = Object.fromEntries(
      Object.entries(copy.command).map(([name, value]) => [
        name,
        isRecord(value) ? { ...value, allowShell: false } : value,
      ]),
    )
  }

  if (isRecord(copy.lsp)) {
    const lsp = Object.fromEntries(
      Object.entries(copy.lsp).filter(([, value]) => isRecord(value) && !("command" in value) && !("env" in value)),
    )
    if (Object.keys(lsp).length > 0) copy.lsp = lsp
    else delete copy.lsp
  }

  if (isRecord(copy.formatter)) {
    const formatter = Object.fromEntries(
      Object.entries(copy.formatter).filter(
        ([, value]) => isRecord(value) && !("command" in value) && !("environment" in value),
      ),
    )
    if (Object.keys(formatter).length > 0) copy.formatter = formatter
    else delete copy.formatter
  }

  // `computer.command` is a repository-selected binary plus its arguments —
  // the computer MCP client spawns it, and it falls back to
  // AX_COMPUTER_COMMAND / PATH only when the config leaves it unset. Same
  // class as `shell` and the lsp/formatter commands above, so an untrusted
  // config may enable a provider but not choose the executable.
  if (isRecord(copy.computer)) {
    const computer = { ...copy.computer }
    delete computer.command
    delete computer.args
    copy.computer = computer
  }

  // Every image provider posts to `options.baseURL` with the resolved
  // credential (`options.apiKey` or the user's OPENAI_API_KEY /
  // STABILITY_API_KEY), and the custom provider takes its endpoint and key
  // from the same place — so an untrusted config could redirect the user's
  // key to its own endpoint. Keep the provider choice and the model, drop the
  // rest, and allowlist the option keys because the schema is a catchall.
  if (isRecord(copy.image_generation)) {
    const imageGeneration = { ...copy.image_generation }
    const options = imageGeneration.options
    if (isRecord(options)) {
      const safe = Object.fromEntries(Object.entries(options).filter(([key]) => key === "model"))
      if (Object.keys(safe).length > 0) imageGeneration.options = safe
      else delete imageGeneration.options
    }
    copy.image_generation = imageGeneration
  }

  // `browser.cdpUrl` picks the browser endpoint the browser_* tools attach
  // to, so a committed config could point them at its own server and both
  // observe and invent every page and action. The documented shape is a local
  // Chrome started with --remote-debugging-port, so an untrusted source may
  // keep a loopback HTTP(S) URL and nothing else; a remote or ws:// endpoint
  // must come from a trusted config.
  if (isRecord(copy.browser) && copy.browser.cdpUrl !== undefined) {
    const browser = { ...copy.browser }
    try {
      Ssrf.loopbackOrigin(browser.cdpUrl as string, "browser.cdpUrl")
    } catch {
      delete browser.cdpUrl
    }
    copy.browser = browser
  }

  // Untrusted project config must not loosen an explicit lower-precedence
  // safety policy. A committed ax-code.json could otherwise override a
  // managed or user setting with isolation.mode = full-access, enable
  // network, or replace the blocked-path list (blocked_paths: []) with no
  // agent write at all — a load-time privilege escalation. Project config
  // may tighten (read-only, network off, additional blocked paths) but never
  // loosen a user/managed floor. Mirrors Codex requirements.toml / Claude
  // managed-settings behavior.
  if (isRecord(copy.isolation)) {
    const isolation = { ...copy.isolation }
    if (isolation.mode === "full-access") delete isolation.mode
    if (isolation.network === true) delete isolation.network
    // backend "app"/"auto" can drop the kernel sandbox, loosening a user or
    // managed floor; only the tightening "os" value may survive.
    if (isolation.backend !== undefined && isolation.backend !== "os") delete isolation.backend
    // `protected` itself is intentionally left alone here: it is a
    // tightening-only, additive list (see mergeConfig, which
    // concatenates it across sources instead of letting a later source
    // replace it), so an untrusted config can only add protected paths,
    // never drop ones a trusted lower-precedence source added.
    copy.isolation = isolation
  }
  if (isRecord(copy.autonomy) && isRecord(copy.autonomy.budget) && isRecord(copy.autonomy.budget.changes)) {
    const changes = { ...copy.autonomy.budget.changes }
    delete changes.blocked_paths
    copy.autonomy = { ...copy.autonomy, budget: { ...copy.autonomy.budget, changes } }
  }
  if (isRecord(copy.experimental) && isRecord(copy.experimental.autonomous_caps)) {
    const caps = { ...copy.experimental.autonomous_caps }
    delete caps.blockedPaths
    copy.experimental = { ...copy.experimental, autonomous_caps: caps }
  }
  // Cloud-operations strict mode changes permission-layer enforcement
  // behavior (it replaces the bash_destructive ask with a hard deny). Like
  // the executable/credential fields above, an untrusted committed config
  // may not flip it; projects opt in via the out-of-repository trust switch
  // or trusted user/managed config.
  if (isRecord(copy.ops)) {
    const ops = { ...copy.ops }
    delete ops.strict
    if (Object.keys(ops).length > 0) copy.ops = ops
    else delete copy.ops
  }
  return copy
}

// Isolation modes from strictest to loosest. `restrictUntrustedConfig`
// drops the absolute worst value ("full-access") per source, but it runs
// before any merging and cannot see the accumulated floor, so an untrusted
// repository config could still relax a user's `read-only` to
// `workspace-write`.
const ISOLATION_STRICTNESS = { "read-only": 2, "workspace-write": 1, "full-access": 0 } as const

/** An untrusted source may tighten the isolation mode, never loosen it. */
export function tightenIsolationFloor(target: Info, source: Info): Info {
  if (!source.isolation) return source
  const isolation = { ...source.isolation }
  const incoming = isolation.mode
  const floor = target.isolation?.mode
  if (incoming && floor && ISOLATION_STRICTNESS[incoming] < ISOLATION_STRICTNESS[floor]) delete isolation.mode
  // The object form turns network on (with an egress allowlist). It only
  // narrows a floor that already allows all network; over a disabled or
  // unset floor it would enable network, like the `true` the per-source
  // filter already drops.
  if (typeof isolation.network === "object" && target.isolation?.network !== true) delete isolation.network
  return { ...source, isolation }
}
