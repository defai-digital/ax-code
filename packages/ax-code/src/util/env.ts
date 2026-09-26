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
    "muse-cli": ["META_API_KEY", "MODEL_API_KEY", "META_MODEL_API_KEY"],
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

  /**
   * Whole-word credential key names, normalized. Stricter than a substring
   * match on purpose: `keyboard`, `tokenCount` and `monkey` are not credentials,
   * and over-redacting makes records useless while looking safe. `auth`,
   * `bearer` and `cookie` are here because a header dump names them exactly that
   * way, and the `token`/`key`-suffixed spellings are what OAuth clients emit.
   */
  const CREDENTIAL_KEY_NAME =
    /^(?:token|secret|password|passwd|credential|credentials|authorization|auth|bearer|cookie|pat|webhook|api[_-]?key|x[_-]?api[_-]?key|private[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret)$/i

  /**
   * True when a structured key names a credential, so the whole value behind it
   * must be hidden. Shared by the log sink (`util/log.ts`) and the persisted
   * tool-input redactor (`session/processor-impl.ts`) so both layers hide the
   * same keys.
   */
  export function isCredentialKeyName(name: string): boolean {
    return CREDENTIAL_KEY_NAME.test(name)
  }

  export function isProcessInjectionName(name: string): boolean {
    return PROCESS_INJECTION_NAMES.has(name)
  }

  // Presigned URLs and webhook-style links often carry credentials in the
  // query string rather than as userinfo. Treat common credential parameter
  // names as sensitive so an innocently named variable cannot forward them.
  // One name list feeds both the env filter below and the record redactor, so
  // the two layers of the same boundary cannot drift apart.
  const CREDENTIAL_QUERY_NAMES = "signature|credential|token|secret|password|passwd|api[_-]?key|access[_-]?key"
  const CREDENTIAL_URL_QUERY = new RegExp(`(?:${CREDENTIAL_QUERY_NAMES})=`, "i")
  // The value behind such a parameter, up to the next `&`, fragment or
  // delimiter. The optional name prefix keeps vendor spellings working
  // (`X-Amz-Signature`, `my-access-key`) because the name list is matched
  // without word boundaries, exactly like the detector above.
  const CREDENTIAL_QUERY_VALUE = new RegExp(
    `([?&][A-Za-z0-9_.-]{0,32}?(?:${CREDENTIAL_QUERY_NAMES})=)[^&#\\s"'<>]*`,
    "gi",
  )

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

  /**
   * Redact key/value, authorization, cookie, URI-credential spellings and bare
   * credential *value* shapes (`sk-…`, a JWT, a private-key block) from a
   * string. Shared by the log sink and (through `redactForRecord`) every
   * durable record, so a secret is hidden in the same way wherever it lands.
   */
  export function redactSecrets(value: string): string {
    const jsonRedacted = value.replace(
      // The value class excludes a bare backslash and consumes escape pairs as
      // a unit: `[^"'\r\n]*` treated the quote of an escaped `\"` as the
      // closing delimiter, so `{"password":"one\"two"}` became
      // `{"password":"[redacted]"two"}` — a leaked tail and malformed JSON.
      /(["'])(token|secret|password|passwd|credential|authorization|cookie|api[_-]?key)\1\s*:\s*(["'])(?:\\.|[^"'\r\n\\])*\3/gi,
      (_match, quote: string, key: string, valueQuote: string) =>
        `${quote}${key}${quote}:${valueQuote}[redacted]${valueQuote}`,
    )
    const fieldsRedacted = jsonRedacted.replace(
      // `basic` alongside `bearer`, and `cookie` alongside `authorization`:
      // `Authorization: Basic <base64>` left the encoded credential behind, and
      // a `Cookie:` header was not matched at all even though the structured
      // sink (`Env.isCredentialKeyName`) and MCP trust already treat `cookie` as
      // a credential name. `\bcookie\b` also covers `Set-Cookie`.
      //
      // The value alternation consumes an existing `[redacted]` placeholder as
      // one unit before falling back to a bare word. Without it a second pass
      // matches only `[redacted` (the run stops at `]`) and re-emits the
      // placeholder with the bracket still there — `--password=[redacted]]`.
      // Redaction has to survive re-application: the log sink re-redacts values
      // that callers already redacted (`mcp/impl.ts` MCP stderr) and session
      // evidence re-redacts persisted tool output, so a nested application is a
      // production path, not a hypothetical one.
      //
      // Quoted values are consumed with their quotes: a bare run stops at the
      // first space, so `--password="hunter2 extra"` used to leave ` extra"`
      // behind — the tail of a quoted credential stayed in the record.
      /\b(token|secret|password|passwd|credential|authorization|cookie|api[_-]?key)\b\s*(?:=|:)\s*(?:(?:bearer|basic)\s+)?(?:"(?:[^"\\\r\n]|\\.)*"|'(?:[^'\\\r\n]|\\.)*'|\[redacted\][^\s,;}\]]*|[^\s,;}\]]+)/gi,
      (_match, key: string) => `${key}=[redacted]`,
    )
    // Any RFC 3986 scheme, not just http(s): connection strings such as
    // `postgres://`, `redis://`, `mongodb+srv://`, and `amqp://` carry
    // `user:password@` userinfo too, and a free-text log message has no `KEY=`
    // assignment for `redactInlineEnvAssignments` to catch. The username may be
    // empty (`redis://:password@host` is a documented form). The sibling
    // `URL_USERINFO_VALUE` already accepts every scheme for assignments.
    return fieldsRedacted
      .replace(
        /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/:@]*):([^\s/@]+)@/gi,
        (_match, scheme: string, username: string) => `${scheme}${username}:[redacted]@`,
      )
      .replace(CREDENTIAL_QUERY_VALUE, "$1[redacted]")
      .replace(PRIVATE_KEY_BLOCK, "[redacted private key]")
      // A truncated key dump (`head -c`, a size-capped tool output, a record cut
      // mid-write) has no END marker, so the paired pattern above never matches
      // and the base64 body survived. Everything after an unpaired header is key
      // material, so redact the remainder. Idempotent: the placeholder carries
      // no BEGIN marker.
      .replace(UNPAIRED_PRIVATE_KEY_BLOCK, "[redacted private key]")
      .replace(SECRET_VALUE, "[redacted secret]")
  }

  /**
   * Credential *value* shapes: the same set the pre-commit hook refuses to
   * commit, plus a JWT. No key name can catch these — a provider echoes a key as
   * bare prose ("Incorrect API key provided: sk-…") with no `key=` anywhere, and
   * a command can carry one with no assignment or header around it. They are
   * redacted here rather than in the log sink so every durable record (persisted
   * tool input, session evidence, goal check output) loses them too.
   */
  const PRIVATE_KEY_BLOCK = /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g
  const UNPAIRED_PRIVATE_KEY_BLOCK = /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*/g
  const SECRET_VALUE =
    /(?:sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{20,}|xoxb-[0-9]{10,}-[a-zA-Z0-9]{24,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g

  /**
   * Full redaction for a string that will be persisted, shown, or recorded:
   * URI/header/flag credentials (`redactSecrets`) plus shell `KEY=VALUE`
   * assignments (`redactInlineEnvAssignments`). The order is fixed here on
   * purpose — running the assignment pass first re-matches its own `[redacted]`
   * placeholder for a keyword-named key and emits `API_KEY=[redacted]]`, so
   * callers must not compose the two passes themselves. Use this everywhere a
   * redacted copy is stored (log sinks, session evidence, persisted tool input,
   * tool descriptions).
   */
  export function redactForRecord(value: string): string {
    return redactInlineEnvAssignments(redactSecrets(value))
  }

  // Assignment starts after shell separators. A flag's `-` is deliberately
  // not a boundary, so spellings like `--env=production` stay unchanged.
  const INLINE_ENV_ASSIGNMENT = /(^|[\s;|&(])([A-Za-z_][A-Za-z0-9_]*=)/g
  // Any assigned value carrying credentials as URL userinfo
  // (scheme://user:pass@…) is redacted even when the variable name looks
  // innocuous (e.g. FOO=postgres://u:pw@host/db).
  const URL_USERINFO_VALUE = /^[a-z][a-z0-9+.-]*:\/\/[^/\s]*@/

  // Read one literal shell word, including concatenated quoted segments and
  // escaped separators. This does not evaluate shell expansions. Unclosed
  // quotes conservatively consume the remainder of the persisted copy.
  function inlineEnvWord(value: string, start: number, sensitiveName: boolean): { end: number; literal: string } {
    let quote: "'" | '"' | undefined
    let literal = ""
    let end = start
    for (; end < value.length; end++) {
      const char = value[end]!
      const next = value[end + 1]
      if (char === "\\" && quote !== "'" && next !== undefined && (quote === undefined || /[$`"\\\n]/.test(next))) {
        if (next !== "\n") literal += next
        end++
        continue
      }
      if (
        sensitiveName &&
        quote !== "'" &&
        (char === "`" ||
          (char === "$" && (next === "(" || next === "{")) ||
          (quote === undefined && (char === "(" || ((char === "<" || char === ">") && next === "("))))
      ) {
        // Nested expansions and arrays need a full shell grammar to locate
        // their end. Hide the remaining persisted command instead of leaking
        // a literal suffix. Safe assignments keep scanning for later secrets.
        return { end: value.length, literal: "" }
      }
      if (quote !== undefined) {
        if (char === quote) quote = undefined
        else literal += char
        continue
      }
      if (char === '"' || char === "'") {
        quote = char
        continue
      }
      if (/[\s;|&()<>]/.test(char)) break
      literal += char
    }
    return { end, literal }
  }

  /**
   * Redact inline `KEY=VALUE` credential assignments from a shell command
   * before it is persisted (event log, message parts, doom-loop
   * fingerprints). Callers must keep executing the original string — this
   * copy is for durable records only.
   */
  export function redactInlineEnvAssignments(value: string): string {
    const parts: string[] = []
    let copied = 0
    let scanned = 0
    for (const match of value.matchAll(INLINE_ENV_ASSIGNMENT)) {
      if (match.index < scanned) continue
      const start = match.index + match[0].length
      const name = match[2]!.slice(0, -1)
      const sensitiveName =
        isSensitiveName(name) || PAT_NAME.test(name) || WEBHOOK_NAME.test(name) || CREDENTIAL_URL_NAME.test(name)
      const word = inlineEnvWord(value, start, sensitiveName)
      scanned = word.end
      if (word.end === start || (!sensitiveName && !URL_USERINFO_VALUE.test(word.literal))) continue
      parts.push(value.slice(copied, start), "[redacted]")
      copied = word.end
    }
    return parts.length === 0 ? value : parts.join("") + value.slice(copied)
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
