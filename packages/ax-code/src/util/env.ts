export namespace Env {
  // Strip secrets from a process environment before forwarding to child
  // processes. An LLM prompt that instructs a spawned shell to run
  // `env` or `echo $OPENAI_API_KEY` could otherwise exfiltrate provider
  // tokens, passwords, and other credentials held by the parent
  // process. Defaults to a strict keyword match so non-standard secret-like
  // names are filtered too (for example OPENAI_APIKEY or AWS_ACCESSKEY).
  const SECRET_PATTERN = /KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|AUTH/i
  // "PAT" as a whole word: catches AZURE_DEVOPS_EXT_PAT and GH_PAT without
  // matching PATH/PATHEXT (which contain PAT only as a substring).
  const PAT_NAME = /(^|_)PAT(_|$)/i
  // Webhook URLs are write credentials regardless of host.
  const WEBHOOK_NAME = /WEBHOOK/i
  const CREDENTIAL_URL_NAME = /(?:DATABASE|REDIS|AMQP|MONGODB|POSTGRES|MYSQL|ELASTIC|BROKER)_?(?:URL|URI)/i
  // Paths to files that themselves hold credentials.
  const CREDENTIAL_FILE_NAMES = new Set(["KUBECONFIG"])
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

  // Provider API keys CLI subprocesses (claude-code, codex-cli, etc.) need
  // forwarded. Kept out of SAFE_ALLOWLIST so pty user env and untrusted
  // {env:} config substitution still strip them — only the CLI provider
  // spawn path opts into forwarding via `withCliProviderKeys`.
  const CLI_PROVIDER_KEYS: Record<string, readonly string[]> = {
    "codex-cli": ["OPENAI_API_KEY"],
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
        CREDENTIAL_FILE_NAMES.has(k) ||
        isSensitiveName(k) ||
        PAT_NAME.test(k) ||
        WEBHOOK_NAME.test(k) ||
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

  // Presigned URLs and webhook-style links often carry credentials in the
  // query string rather than as userinfo. Treat common credential parameter
  // names as sensitive so an innocently named variable cannot forward them.
  const CREDENTIAL_URL_QUERY = /(signature|credential|token|secret|password|passwd|api[_-]?key|access[_-]?key)=/i

  function containsUrlCredential(value: string | undefined): boolean {
    if (!value || !value.includes("://")) return false
    try {
      const parsed = new URL(value)
      if (parsed.username.length > 0 || parsed.password.length > 0) return true
      return CREDENTIAL_URL_QUERY.test(parsed.search)
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

  // Inline `KEY=VALUE` spellings in shell command lines. The prefix boundary
  // (start, whitespace, or `;`) keeps flag spellings like `--env=production`
  // untouched because `-` is not a valid assignment boundary.
  const INLINE_ENV_ASSIGNMENT = /(^|[\s;])((?:[A-Za-z_][A-Za-z0-9_]*)=)([^\s"';]+)/g
  // Any assigned value carrying credentials as URL userinfo
  // (scheme://user:pass@…) is redacted even when the variable name looks
  // innocuous (e.g. FOO=postgres://u:pw@host/db).
  const URL_USERINFO_VALUE = /^[a-z][a-z0-9+.-]*:\/\/[^/\s]*@/

  /**
   * Redact inline `KEY=VALUE` credential assignments from a shell command
   * before it is persisted (event log, message parts, doom-loop
   * fingerprints). Callers must keep executing the original string — this
   * copy is for durable records only.
   */
  export function redactInlineEnvAssignments(value: string): string {
    return value.replace(INLINE_ENV_ASSIGNMENT, (match, prefix: string, assignment: string, assigned: string) => {
      const name = assignment.slice(0, -1)
      const sensitiveName =
        isSensitiveName(name) || PAT_NAME.test(name) || WEBHOOK_NAME.test(name) || CREDENTIAL_URL_NAME.test(name)
      if (!sensitiveName && !URL_USERINFO_VALUE.test(assigned)) return match
      return `${prefix}${assignment}[redacted]`
    })
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
