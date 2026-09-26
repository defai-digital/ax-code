import { describe, expect, test } from "vitest"
import { Env } from "../../src/util/env"

describe("Env.parseBoolean", () => {
  test("recognizes true/1/yes/on as true", () => {
    for (const value of ["true", "TRUE", "1", "yes", "YES", "on", "ON", " on "]) {
      expect(Env.parseBoolean(value)).toBe(true)
    }
  })

  test("recognizes false/0/no/off as false", () => {
    for (const value of ["false", "FALSE", "0", "no", "NO", "off", "OFF", " off "]) {
      expect(Env.parseBoolean(value)).toBe(false)
    }
  })

  test("returns undefined for unset or unrecognized values", () => {
    for (const value of [undefined, "", "maybe", "2", "enabled"]) {
      expect(Env.parseBoolean(value)).toBeUndefined()
    }
  })
})

describe("Env.redactInlineEnvAssignments", () => {
  test("redacts sensitive-looking KEY=VALUE assignments", () => {
    expect(Env.redactInlineEnvAssignments("AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI aws s3 ls")).toBe(
      "AWS_SECRET_ACCESS_KEY=[redacted] aws s3 ls",
    )
    expect(Env.redactInlineEnvAssignments("AZURE_CLIENT_SECRET=abc123 az login")).toBe(
      "AZURE_CLIENT_SECRET=[redacted] az login",
    )
    expect(Env.redactInlineEnvAssignments("TF_TOKEN_example_org=xxxx terraform plan")).toBe(
      "TF_TOKEN_example_org=[redacted] terraform plan",
    )
    expect(Env.redactInlineEnvAssignments("CLOUDFLARE_API_TOKEN=zzzz wrangler deploy")).toBe(
      "CLOUDFLARE_API_TOKEN=[redacted] wrangler deploy",
    )
  })

  test("redacts credential URLs on credential-URL names and URL userinfo values", () => {
    expect(Env.redactInlineEnvAssignments("DATABASE_URL=postgres://u:pw@host/db psql")).toBe(
      "DATABASE_URL=[redacted] psql",
    )
    // URL userinfo redacts even when the key name looks innocuous.
    expect(Env.redactInlineEnvAssignments("FOO=postgres://u:pw@host/db run")).toBe("FOO=[redacted] run")
    expect(Env.redactInlineEnvAssignments("REF=https://user:pass@example.com/repo.git clone")).toBe(
      "REF=[redacted] clone",
    )
  })

  test("leaves non-sensitive assignments and flag spellings unchanged", () => {
    const command =
      "FOO=bar PATH=/usr/bin AWS_REGION=us-east-1 NODE_ENV=production deploy --env=production --flag=value"
    expect(Env.redactInlineEnvAssignments(command)).toBe(command)
  })

  test("redacts multiple assignments and semicolon-separated commands", () => {
    expect(Env.redactInlineEnvAssignments("AWS_SECRET_ACCESS_KEY=aaa bash run.sh;GH_PAT=bbb git push")).toBe(
      "AWS_SECRET_ACCESS_KEY=[redacted] bash run.sh;GH_PAT=[redacted] git push",
    )
  })

  test("preserves the prefix boundary character and quoted values", () => {
    expect(Env.redactInlineEnvAssignments("  API_KEY=abc curl")).toBe("  API_KEY=[redacted] curl")
    // Values terminated by quotes/semi-colons are not consumed past the boundary.
    expect(Env.redactInlineEnvAssignments('SECRET_KEY=abc; echo "SECRET_KEY=abc"')).toBe(
      'SECRET_KEY=[redacted]; echo "SECRET_KEY=abc"',
    )
    expect(Env.redactInlineEnvAssignments('GITHUB_TOKEN="placeholder-token-value" gh api')).toBe(
      "GITHUB_TOKEN=[redacted] gh api",
    )
    expect(Env.redactInlineEnvAssignments("API_KEY='placeholder-token-value' curl")).toBe("API_KEY=[redacted] curl")
  })

  test.each([
    "API_KEY=prefix\"middle\"'suffix' run",
    'API_KEY="placeholder\\"token" run',
    "API_KEY='placeholder'\\''token' run",
    "API_KEY=placeholder\\ token run",
    "API_KEY=placeholder\\;token run",
    "API_KEY=placeholder\\\ntoken run",
  ])("redacts the complete quoted or escaped shell word: %s", (command) => {
    expect(Env.redactInlineEnvAssignments(command)).toBe("API_KEY=[redacted] run")
  })

  test.each([
    ["true&&API_KEY=placeholder run", "true&&API_KEY=[redacted] run"],
    ["false||API_KEY=placeholder run", "false||API_KEY=[redacted] run"],
    ["printf ready|API_KEY=placeholder cat", "printf ready|API_KEY=[redacted] cat"],
    ["(API_KEY=placeholder run)", "(API_KEY=[redacted] run)"],
    ["API_KEY=placeholder&&printf ready", "API_KEY=[redacted]&&printf ready"],
    ["API_KEY=placeholder>output.log", "API_KEY=[redacted]>output.log"],
  ])("recognizes shell operator boundaries: %s", (command, expected) => {
    expect(Env.redactInlineEnvAssignments(command)).toBe(expected)
  })

  test("recognizes URL userinfo assembled from quoted literal segments", () => {
    expect(Env.redactInlineEnvAssignments("FETCH_URL=https://user:'placeholder'@example.test/path run")).toBe(
      "FETCH_URL=[redacted] run",
    )
  })

  test("preserves safe quoted and escaped assignments verbatim", () => {
    const command = 'NAME=prefix"middle"\'suffix\' LABEL=hello\\ world PATH="/usr/bin" run --api-key=unchanged'
    expect(Env.redactInlineEnvAssignments(command)).toBe(command)
  })

  test.each([
    "API_KEY=$(echo<placeholder) run",
    'API_KEY="$(printf "%s" "placeholder value")" run',
    "API_KEY=${MISSING:-placeholder value} run",
    "API_KEY=`printf placeholder` run",
    "API_KEY=<(printf placeholder) run",
    "API_KEY=(placeholder) run",
  ])("conservatively redacts complex sensitive assignment suffixes: %s", (command) => {
    expect(Env.redactInlineEnvAssignments(command)).toBe("API_KEY=[redacted]")
  })

  test("continues scanning after safe expansions and preserves quoted expansion literals", () => {
    expect(Env.redactInlineEnvAssignments("SAFE=$(printf x) API_KEY=placeholder run")).toBe(
      "SAFE=$(printf x) API_KEY=[redacted] run",
    )
    expect(Env.redactInlineEnvAssignments("API_KEY='$(printf placeholder)' run")).toBe("API_KEY=[redacted] run")
  })

  test("is idempotent", () => {
    const once = Env.redactInlineEnvAssignments("AWS_SECRET_ACCESS_KEY=awskey AWS_REGION=us-east-1 aws s3 ls")
    expect(Env.redactInlineEnvAssignments(once)).toBe(once)
    expect(once).toBe("AWS_SECRET_ACCESS_KEY=[redacted] AWS_REGION=us-east-1 aws s3 ls")
  })
})

describe("Env.sanitize", () => {
  test("redacts secret-like environment variable names even without separators", () => {
    const env = {
      OPENAI_APIKEY: "openai",
      AWSACCESSKEY: "aws",
      MYSECRET: "custom",
      APITOKEN: "token",
      API_SECRET: "safe-secret",
      PATH: "/usr/local/bin",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
      GIT_CREDENTIAL_HELPER: "store",
      GIT_ASKPASS: "/usr/bin/askpass",
    }

    const sanitized = Env.sanitize(env)

    expect(sanitized.OPENAI_APIKEY).toBeUndefined()
    expect(sanitized.AWSACCESSKEY).toBeUndefined()
    expect(sanitized.MYSECRET).toBeUndefined()
    expect(sanitized.APITOKEN).toBeUndefined()
    expect(sanitized.API_SECRET).toBeUndefined()
    expect(sanitized.PATH).toBe("/usr/local/bin")
    expect(sanitized.SSH_AUTH_SOCK).toBeUndefined()
    expect(sanitized.GIT_ASKPASS).toBeUndefined()
    expect(sanitized.GIT_CREDENTIAL_HELPER).toBeUndefined()
  })

  test("strips provider API key env vars from general sanitized environments", () => {
    const sanitized = Env.sanitize({
      GEMINI_API_KEY: "gemini-key",
      OPENAI_API_KEY: "openai-key",
      ANTHROPIC_API_KEY: "anthropic-key",
      XAI_API_KEY: "xai-key",
    })

    expect(sanitized.GEMINI_API_KEY).toBeUndefined()
    expect(sanitized.OPENAI_API_KEY).toBeUndefined()
    expect(sanitized.ANTHROPIC_API_KEY).toBeUndefined()
    expect(sanitized.XAI_API_KEY).toBeUndefined()
  })

  test("strips credentials embedded in URL values", () => {
    const sanitized = Env.sanitize({
      SAFE_URL: "https://example.com/api",
      PRIVATE_REGISTRY: "https://alice:secret@example.com/npm",
    })

    expect(sanitized.SAFE_URL).toBe("https://example.com/api")
    expect(sanitized.PRIVATE_REGISTRY).toBeUndefined()
  })

  test("strips kubeconfig, webhook, and PAT-named variables but not PATH-like names", () => {
    const sanitized = Env.sanitize({
      KUBECONFIG: "/home/user/.kube/config",
      SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/T000/B000/XXXX",
      DISCORD_WEBHOOK: "https://discord.com/api/webhooks/123/abc",
      AZURE_DEVOPS_EXT_PAT: "azure-pat",
      GH_PAT: "gh-pat",
      PATH: "/usr/bin",
      PATHEXT: ".COM;.EXE",
    })

    expect(sanitized.KUBECONFIG).toBeUndefined()
    expect(sanitized.SLACK_WEBHOOK_URL).toBeUndefined()
    expect(sanitized.DISCORD_WEBHOOK).toBeUndefined()
    expect(sanitized.AZURE_DEVOPS_EXT_PAT).toBeUndefined()
    expect(sanitized.GH_PAT).toBeUndefined()
    expect(sanitized.PATH).toBe("/usr/bin")
    expect(sanitized.PATHEXT).toBe(".COM;.EXE")
  })

  test("strips URLs carrying credentials in the query string", () => {
    const sanitized = Env.sanitize({
      PRESIGNED: "https://s3.example.com/object?X-Amz-Credential=AKID&X-Amz-Signature=abc",
      CALLBACK: "https://example.com/hook?access_token=abc123",
      PLAIN_DOWNLOAD: "https://example.com/file?format=raw",
    })

    expect(sanitized.PRESIGNED).toBeUndefined()
    expect(sanitized.CALLBACK).toBeUndefined()
    expect(sanitized.PLAIN_DOWNLOAD).toBe("https://example.com/file?format=raw")
  })

  test("strips process-injection variables from sanitized environments", () => {
    const sanitized = Env.sanitize({
      PATH: "/usr/bin",
      LD_PRELOAD: "/tmp/evil.so",
      DYLD_INSERT_LIBRARIES: "/tmp/evil.dylib",
      NODE_OPTIONS: "--require ./shim.js",
      PYTHONPATH: "/tmp/evil",
      SAFE: "ok",
    })

    expect(sanitized.PATH).toBe("/usr/bin")
    expect(sanitized.SAFE).toBe("ok")
    expect(sanitized.LD_PRELOAD).toBeUndefined()
    expect(sanitized.DYLD_INSERT_LIBRARIES).toBeUndefined()
    expect(sanitized.NODE_OPTIONS).toBeUndefined()
    expect(sanitized.PYTHONPATH).toBeUndefined()
  })

  test("stripProcessInjection removes load-time hijacks but keeps secrets", () => {
    const stripped = Env.stripProcessInjection({
      MCP_API_KEY: "secret-from-config",
      LD_PRELOAD: "/tmp/evil.so",
      NODE_OPTIONS: "--require ./shim.js",
      PATH: "/custom/bin",
    })

    expect(stripped.MCP_API_KEY).toBe("secret-from-config")
    expect(stripped.PATH).toBe("/custom/bin")
    expect(stripped.LD_PRELOAD).toBeUndefined()
    expect(stripped.NODE_OPTIONS).toBeUndefined()
  })

  test("redacts authorization headers, JSON secrets, and URL credentials", () => {
    expect(Env.redactSecrets("Authorization: Bearer abc123")).toBe("Authorization=[redacted]")
    expect(Env.redactSecrets('{"token":"abc123","safe":"yes"}')).toBe('{"token":"[redacted]","safe":"yes"}')
    expect(Env.redactSecrets("https://alice:secret@example.com/path")).toBe("https://alice:[redacted]@example.com/path")
  })

  test("redacts URI credentials for any scheme, not just http(s)", () => {
    // Connection strings reach the log writer and 4 other sinks as free text,
    // so there is no KEY= assignment for redactInlineEnvAssignments to catch.
    expect(Env.redactSecrets("postgres://admin:s3cret@db.internal/app")).toBe(
      "postgres://admin:[redacted]@db.internal/app",
    )
    expect(Env.redactSecrets("redis://default:hunter2@cache:6379")).toBe("redis://default:[redacted]@cache:6379")
    expect(Env.redactSecrets("mongodb+srv://u:p@cluster/db")).toBe("mongodb+srv://u:[redacted]@cluster/db")
    // Redis/Docker empty-username form.
    expect(Env.redactSecrets("redis://:hunter2@cache:6379")).toBe("redis://:[redacted]@cache:6379")
    expect(Env.redactSecrets("connect failed: postgres://root:topsecret@10.0.0.5/prod")).toBe(
      "connect failed: postgres://root:[redacted]@10.0.0.5/prod",
    )
  })

  test("redacts Authorization Basic credentials and leaves look-alikes intact", () => {
    // The field pattern used to stop after the space, leaving the base64 body.
    expect(Env.redactSecrets("Authorization: Basic dXNlcjpwYXNzd29yZA==")).toBe("Authorization=[redacted]")
    // The structured sink already treats `cookie` as a credential name; the
    // header spelling must be caught here too (`\bcookie\b` covers Set-Cookie).
    expect(Env.redactSecrets("Cookie: session=abc123")).toBe("Cookie=[redacted]")
    expect(Env.redactSecrets("Set-Cookie: sid=xyz; Path=/")).toBe("Set-Cookie=[redacted]; Path=/")
    // A missing password, a non-URI scheme, an scp-style remote, and a bare
    // username must not be treated as embedded credentials.
    expect(Env.redactSecrets("https://example.com:443/path")).toBe("https://example.com:443/path")
    expect(Env.redactSecrets("mailto:user@example.com")).toBe("mailto:user@example.com")
    expect(Env.redactSecrets("git@github.com:org/repo.git")).toBe("git@github.com:org/repo.git")
    expect(Env.redactSecrets("ssh://git@host/repo")).toBe("ssh://git@host/repo")
  })

  test("redactForRecord composes both passes without doubling the placeholder", () => {
    // Order is fixed inside the helper: an assignment to a keyword-named key is
    // redacted once, not re-matched into `[redacted]]`.
    expect(Env.redactForRecord("API_KEY=placeholder-token-value ./run")).toBe("API_KEY=[redacted] ./run")
    expect(Env.redactForRecord("TOKEN=abc123")).toBe("TOKEN=[redacted]")
    // Header, flag, and URI credentials are covered by the same call.
    expect(Env.redactForRecord('curl -H "Authorization: Bearer sk-x" https://api')).toContain(
      "Authorization=[redacted]",
    )
    expect(Env.redactForRecord("mysql --password=supersecret -e 'select 1'")).toContain("password=[redacted]")
    expect(Env.redactForRecord("curl 'redis://:hunter2@cache:6379'")).not.toContain("hunter2")
    // Text with no credential shape is untouched.
    expect(Env.redactForRecord("plain text with no secrets")).toBe("plain text with no secrets")
  })

  test("redactForRecord survives re-application at a nested record sink", () => {
    // Redaction is applied at more than one layer in production: the log sink
    // re-redacts a value its caller already redacted (MCP stderr in
    // `mcp/impl.ts`) and session evidence re-redacts persisted tool output. A
    // second pass used to match only `[redacted` because the value run stops at
    // `]`, re-emitting the placeholder as `--password=[redacted]]`.
    const shapes = [
      "mysql --password=supersecret -e 'select 1'",
      'curl -H "Authorization: Bearer sk-x" https://api',
      "curl -H 'X-Api-Key: abcdef' https://api",
      "Set-Cookie: sid=xyz; Path=/",
      "cookie=abc",
      "API_KEY=placeholder-token-value ./run",
      "FOO=postgres://u:pw@host/db run",
      '{"password":"hunter2","keep":1}',
    ]
    for (const shape of shapes) {
      const once = Env.redactForRecord(shape)
      expect(Env.redactForRecord(once)).toBe(once)
    }
    expect(Env.redactForRecord("mysql --password=[redacted] -e 'select 1'")).toBe(
      "mysql --password=[redacted] -e 'select 1'",
    )
    // A placeholder followed by more characters still consumes the suffix
    // rather than leaving it as the visible remainder.
    expect(Env.redactForRecord("mysql --password=[redacted]tail -e 'select 1'")).toBe(
      "mysql --password=[redacted] -e 'select 1'",
    )
  })

  test("redacts a quoted value with spaces as one unit", () => {
    // The value run stops at the first space, so a quoted credential used to
    // leave its tail in the record: `--password="hunter2 extra"` became
    // `--password=[redacted] extra"`.
    expect(Env.redactForRecord('mysql --password="hunter2 extra" -e "select 1"')).toBe(
      'mysql --password=[redacted] -e "select 1"',
    )
    expect(Env.redactForRecord("mysql --password='hunter2 extra' -e 'select 1'")).toBe(
      "mysql --password=[redacted] -e 'select 1'",
    )
  })

  test("redacts bare credential value shapes that no key name can catch", () => {
    // The log sink already hides these shapes; a durable record must not keep
    // them just because nothing here carries a key, an `=` or a header.
    const key = "sk-" + "live" + "abcdefghijklmnopqrstuvwxyz"
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop"
    expect(Env.redactSecrets(`echo ${key}`)).toBe("echo [redacted secret]")
    expect(Env.redactForRecord(`echo ${key}`)).toBe("echo [redacted secret]")
    expect(Env.redactForRecord(`curl -H "Auth: ${jwt}" https://api`)).not.toContain(jwt)
    // Assembled at runtime: a literal private-key header trips the pre-commit
    // scanner, and this is a fixture, not a credential.
    const keyHeader = "-----BEGIN " + "RSA PRIVATE KEY-----"
    const keyFooter = "-----END " + "RSA PRIVATE KEY-----"
    expect(Env.redactForRecord(`${keyHeader}\nMIIE\n${keyFooter}`)).toBe("[redacted private key]")
    // Idempotent: the placeholder must survive a second pass.
    expect(Env.redactForRecord("echo [redacted secret]")).toBe("echo [redacted secret]")
  })

  test("redacts an escaped quote inside a JSON secret value", () => {
    // `[^"'\r\n]*` treated the quote of an escaped `\"` as the closing
    // delimiter, so the tail of the secret survived and the record was left
    // malformed: `{"password":"[redacted]"two"}`.
    expect(Env.redactForRecord('{"password":"one\\"two"}')).toBe('{"password":"[redacted]"}')
    expect(Env.redactForRecord('{"token":"a\\"b\\"c","safe":"yes"}')).toBe('{"token":"[redacted]","safe":"yes"}')
  })

  test("redacts a truncated private key dump with no END marker", () => {
    // A size-capped tool output or a record cut mid-write leaves the header
    // without its terminator; everything after it is key material.
    expect(Env.redactForRecord("-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAAbG9jYWxob3N0")).toBe(
      "[redacted private key]",
    )
  })

  test("redacts credential-bearing query values in a URL", () => {
    // `Env.sanitize` already treats these parameter names as credential
    // carriers for env values; the record pass now hides the same values.
    expect(Env.redactForRecord("curl 'https://s3.example.com/b/k?X-Amz-Signature=5f3a9c1e&format=raw'")).toBe(
      "curl 'https://s3.example.com/b/k?X-Amz-Signature=[redacted]&format=raw'",
    )
    expect(Env.redactForRecord("https://example.com/file?format=raw")).toBe("https://example.com/file?format=raw")
    // Idempotent, and the parameter name is preserved for diagnostics.
    expect(Env.redactForRecord("https://s3.example.com/b?X-Amz-Signature=[redacted]")).toBe(
      "https://s3.example.com/b?X-Amz-Signature=[redacted]",
    )
  })

  test("forwards CLI provider API keys only through explicit CLI provider overlay", () => {
    const originalGemini = process.env.GEMINI_API_KEY
    const originalOpenAI = process.env.OPENAI_API_KEY
    const originalAnthropic = process.env.ANTHROPIC_API_KEY
    const originalXai = process.env.XAI_API_KEY
    const originalKimi = process.env.KIMI_API_KEY
    const originalMeta = process.env.META_API_KEY
    const originalMiniMax = process.env.MINIMAX_API_KEY

    try {
      process.env.GEMINI_API_KEY = "gemini-key"
      process.env.OPENAI_API_KEY = "openai-key"
      process.env.ANTHROPIC_API_KEY = "anthropic-key"
      process.env.XAI_API_KEY = "xai-key"
      process.env.KIMI_API_KEY = "kimi-key"
      process.env.META_API_KEY = "meta-key"
      process.env.MINIMAX_API_KEY = "minimax-key"

      const env = Env.withCliProviderKeys(Env.sanitize({ PATH: "/bin" }), "codex-cli")

      expect(env.PATH).toBe("/bin")
      expect(env.OPENAI_API_KEY).toBe("openai-key")
      expect(env.GEMINI_API_KEY).toBeUndefined()
      expect(env.ANTHROPIC_API_KEY).toBeUndefined()
      expect(env.XAI_API_KEY).toBeUndefined()
      expect(env.KIMI_API_KEY).toBeUndefined()
      expect(env.META_API_KEY).toBeUndefined()

      const muse = Env.withCliProviderKeys(Env.sanitize({ PATH: "/bin" }), "muse-cli")
      expect(muse.META_API_KEY).toBe("meta-key")
      expect(muse.OPENAI_API_KEY).toBeUndefined()

      const minimax = Env.withCliProviderKeys(Env.sanitize({ PATH: "/bin" }), "minimax-cli")
      expect(minimax.MINIMAX_API_KEY).toBeUndefined()
      expect(minimax.OPENAI_API_KEY).toBeUndefined()
    } finally {
      if (originalGemini === undefined) delete process.env.GEMINI_API_KEY
      else process.env.GEMINI_API_KEY = originalGemini
      if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = originalOpenAI
      if (originalAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = originalAnthropic
      if (originalXai === undefined) delete process.env.XAI_API_KEY
      else process.env.XAI_API_KEY = originalXai
      if (originalKimi === undefined) delete process.env.KIMI_API_KEY
      else process.env.KIMI_API_KEY = originalKimi
      if (originalMeta === undefined) delete process.env.META_API_KEY
      else process.env.META_API_KEY = originalMeta
      if (originalMiniMax === undefined) delete process.env.MINIMAX_API_KEY
      else process.env.MINIMAX_API_KEY = originalMiniMax
    }
  })
})
