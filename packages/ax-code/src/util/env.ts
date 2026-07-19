export namespace Env {
  // Strip secrets from a process environment before forwarding to child
  // processes. An LLM prompt that instructs a spawned shell to run
  // `env` or `echo $OPENAI_API_KEY` could otherwise exfiltrate provider
  // tokens, passwords, and other credentials held by the parent
  // process. Defaults to a strict keyword match so non-standard secret-like
  // names are filtered too (for example OPENAI_APIKEY or AWS_ACCESSKEY).
  const SECRET_PATTERN = /KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|AUTH/i
  const CREDENTIAL_URL_NAME = /(?:DATABASE|REDIS|AMQP|MONGODB|POSTGRES|MYSQL|ELASTIC|BROKER)_?(?:URL|URI)/i
  const CREDENTIAL_HELPER_NAMES = new Set(["SSH_AUTH_SOCK", "GIT_ASKPASS", "SUDO_ASKPASS"])
  // Variables that rewrite process startup/load behavior. Never forward these
  // to untrusted child processes (MCP servers, shells, formatters, etc.).
  const PROCESS_INJECTION_NAMES = new Set([
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "NODE_OPTIONS",
    "NODE_PATH",
    "NODE_EXTRA_CA_CERTS",
    "ELECTRON_RUN_AS_NODE",
    "PYTHONPATH",
    "PYTHONSTARTUP",
    "RUBYOPT",
    "BASH_ENV",
    "PERL5OPT",
    "JAVA_TOOL_OPTIONS",
    "JAVA_OPTIONS",
    "CLASSPATH",
  ])
  const SAFE_ALLOWLIST = new Set([
    "PYTHON_KEYRING_BACKEND",
    "XAUTHORITY",
    "DOTNET_CLI_TELEMETRY_SESSION_TOKEN",
    // COMPOSER_AUTH removed — contains credentials that match SECRET_PATTERN
    "GPG_AGENT_INFO",
    "DBUS_SESSION_BUS_ADDRESS",
  ])

  // Provider API keys CLI subprocesses (claude-code, gemini-cli, etc.) need
  // forwarded. Kept out of SAFE_ALLOWLIST so pty user env and untrusted
  // {env:} config substitution still strip them — only the CLI provider
  // spawn path opts into forwarding via `withCliProviderKeys`.
  const CLI_PROVIDER_KEYS: Record<string, readonly string[]> = {
    "codex-cli": ["OPENAI_API_KEY"],
    "gemini-cli": ["GEMINI_API_KEY"],
    "claude-code": ["ANTHROPIC_API_KEY"],
    "grok-build-cli": ["XAI_API_KEY"],
    "kimi-cli": ["KIMI_API_KEY"],
  }

  export function withCliProviderKeys(
    env: Record<string, string | undefined>,
    providerID: string | undefined,
  ): Record<string, string | undefined> {
    const out = { ...env }
    for (const key of (providerID && CLI_PROVIDER_KEYS[providerID]) ?? []) {
      const value = process.env[key]
      if (value !== undefined) out[key] = value
    }
    return out
  }

  export function sanitize(env: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries(env)) {
      if (SAFE_ALLOWLIST.has(k)) {
        out[k] = v
        continue
      }
      if (
        PROCESS_INJECTION_NAMES.has(k) ||
        CREDENTIAL_HELPER_NAMES.has(k) ||
        isSensitiveName(k) ||
        CREDENTIAL_URL_NAME.test(k) ||
        containsUrlCredential(v)
      ) {
        continue
      }
      out[k] = v
    }
    return out
  }

  /**
   * Strip process-injection / load-time hijack variables from an env map.
   * Unlike `sanitize`, this preserves secrets so callers that intentionally
   * forward credentials (e.g. MCP `environment`) can still do so safely.
   */
  export function stripProcessInjection(
    env: Record<string, string | undefined> | undefined,
  ): Record<string, string | undefined> {
    if (!env) return {}
    const out: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries(env)) {
      if (PROCESS_INJECTION_NAMES.has(k)) continue
      out[k] = v
    }
    return out
  }

  export function isSensitiveName(name: string): boolean {
    return SECRET_PATTERN.test(name)
  }

  export function isProcessInjectionName(name: string): boolean {
    return PROCESS_INJECTION_NAMES.has(name)
  }

  function containsUrlCredential(value: string | undefined): boolean {
    if (!value || !value.includes("://")) return false
    try {
      const parsed = new URL(value)
      return parsed.username.length > 0 || parsed.password.length > 0
    } catch {
      return false
    }
  }

  /** Redact common key/value and HTTP authorization spellings in child logs. */
  export function redactSecrets(value: string): string {
    const jsonRedacted = value.replace(
      /(["'])(token|secret|password|passwd|credential|authorization|api[_-]?key)\1\s*:\s*(["'])[^"'\r\n]*\3/gi,
      (_match, quote: string, key: string, valueQuote: string) =>
        `${quote}${key}${quote}:${valueQuote}[redacted]${valueQuote}`,
    )
    const fieldsRedacted = jsonRedacted.replace(
      /\b(token|secret|password|passwd|credential|authorization|api[_-]?key)\b\s*(?:=|:)\s*(?:bearer\s+)?[^\s,;}\]]+/gi,
      (_match, key: string) => `${key}=[redacted]`,
    )
    return fieldsRedacted.replace(
      /\b(https?:\/\/)([^\s/:@]+):([^\s/@]+)@/gi,
      (_match, scheme: string, username: string) => `${scheme}${username}:[redacted]@`,
    )
  }

  // Interpret an environment-variable string as a tri-state boolean.
  // Truthy: "true"/"1"/"yes"/"on"; falsy: "false"/"0"/"no"/"off"; anything
  // else (incl. unset) → undefined so callers can distinguish "explicitly
  // set" from "default". The yes/on/no/off forms match the prior Effect
  // `Config.boolean` semantics that flags such as AX_CODE_DISABLE_FILETIME_CHECK
  // relied on before the Effect removal.
  export function parseBoolean(value: string | undefined): boolean | undefined {
    if (!value) return undefined
    const normalized = value.trim().toLowerCase()
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false
    return undefined
  }
}
