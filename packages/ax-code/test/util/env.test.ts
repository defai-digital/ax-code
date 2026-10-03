import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
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
    expect(Env.redactSecrets("Authorization: Bearer abc123")).toBe("Authorization: [redacted]")
    expect(Env.redactSecrets('{"token":"abc123","safe":"yes"}')).toBe('{"token":"[redacted]","safe":"yes"}')
    expect(Env.redactSecrets("https://alice:secret@example.com/path")).toBe("https://alice:[redacted]@example.com/path")
  })

  test("redacts URI credentials for any scheme, not just http(s)", () => {
    // Connection strings reach the log writer and 4 other sinks as free text,
    // so there is no KEY= assignment for redactInlineEnvAssignments to catch.
    // Assembled at runtime: the shape the redactor must catch, not a literal credential.
    const postgres = "postgres://" + "admin" + ":" + "s3cret" + "@db.internal/app"
    expect(Env.redactSecrets(postgres)).toBe("postgres://admin:[redacted]@db.internal/app")
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
    expect(Env.redactSecrets("Authorization: Basic dXNlcjpwYXNzd29yZA==")).toBe("Authorization: [redacted]")
    // Cookie pair values are hidden while Set-Cookie attributes remain useful.
    expect(Env.redactSecrets("Cookie: session=abc123")).toBe("Cookie: session=[redacted]")
    expect(Env.redactSecrets("Set-Cookie: sid=xyz; Path=/")).toBe("Set-Cookie: sid=[redacted]; Path=/")
    // A missing password, a non-URI scheme, an scp-style remote, and a bare
    // username must not be treated as embedded credentials.
    expect(Env.redactSecrets("https://example.com:443/path")).toBe("https://example.com:443/path")
    expect(Env.redactSecrets("mailto:user@example.com")).toBe("mailto:user@example.com")
    expect(Env.redactSecrets("git@github.com:org/repo.git")).toBe("git@github.com:org/repo.git")
    expect(Env.redactSecrets("ssh://git@host/repo")).toBe("ssh://git@host/repo")
  })

  test("redacts every cookie pair while preserving Set-Cookie attributes", () => {
    const request = "curl -H 'Cookie: sid=abc123; pref=xyz789' https://example.test"
    expect(Env.redactSecrets(request)).toBe("curl -H 'Cookie: sid=[redacted]; pref=[redacted]' https://example.test")

    const quoted = 'Cookie: "sid=abc123; pref=xyz789"'
    expect(Env.redactSecrets(quoted)).toBe('Cookie: "sid=[redacted]; pref=[redacted]"')

    const shellQuotedValue = "curl -H 'Cookie: \"sid=abc123; pref=xyz789\"'"
    expect(Env.redactSecrets(shellQuotedValue)).toBe("curl -H 'Cookie: \"sid=[redacted]; pref=[redacted]\"'")

    const response =
      "Set-Cookie: sid=abc123; Path=/; Domain=example.test; Expires=Wed, 21 Oct 2030 07:28:00 GMT; Max-Age=3600; Secure; HttpOnly; SameSite=Lax"
    const redacted =
      "Set-Cookie: sid=[redacted]; Path=/; Domain=example.test; Expires=Wed, 21 Oct 2030 07:28:00 GMT; Max-Age=3600; Secure; HttpOnly; SameSite=Lax"
    expect(Env.redactSecrets(response)).toBe(redacted)
    expect(Env.redactSecrets(redacted)).toBe(redacted)
  })

  test("redacts combined Set-Cookie headers and malformed cookie values", () => {
    const combined = "Set-Cookie: sid=abc123; Path=/, pref=xyz789; Expires=Wed, 21 Oct 2030 07:28:00 GMT; Secure"
    const redacted =
      "Set-Cookie: sid=[redacted]; Path=/, pref=[redacted]; Expires=Wed, 21 Oct 2030 07:28:00 GMT; Secure"
    expect(Env.redactSecrets(combined)).toBe(redacted)
    expect(Env.redactSecrets(redacted)).toBe(redacted)
    expect(Env.redactSecrets("Cookie: raw-secret; sid=abc123")).toBe("Cookie: [redacted]; sid=[redacted]")
    expect(Env.redactSecrets("Set-Cookie: raw-secret; Secure; HttpOnly")).toBe(
      "Set-Cookie: [redacted]; Secure; HttpOnly",
    )
  })

  test("keeps redacting pairs after a quoted run ends early", () => {
    // A quoted first pair that closes before the header value ends must not
    // copy the remaining pairs verbatim.
    expect(Env.redactSecrets("curl -H \"Cookie: 'a=1'; sid=SECRET\" https://example.test")).toBe(
      "curl -H \"Cookie: 'a=[redacted]'; sid=[redacted]\" https://example.test",
    )
    // And the redaction stays idempotent once the tail is a placeholder.
    const once = Env.redactSecrets('Set-Cookie: "a=1"; sid=SECRET')
    expect(once).toBe('Set-Cookie: "a=[redacted]"; sid=[redacted]')
    expect(Env.redactSecrets(once)).toBe(once)
  })

  test("keeps redacting pairs after a stray quote closes on the same line", () => {
    // A lone apostrophe in prose must not truncate the redacted span.
    expect(Env.redactSecrets("it's Cookie: a=1' sid=SECRET")).toBe("it's Cookie: a=[redacted]' sid=[redacted]")
  })

  test("leaves non-pair tails after a closed quote untouched", () => {
    // Prose following a closed quote is not a cookie pair and must survive.
    expect(Env.redactSecrets('Cookie: "a=1" request sent')).toBe('Cookie: "a=[redacted]" request sent')
  })

  test("redacts every shell-quoted cookie header on the same line", () => {
    const request = "curl -H 'Cookie: sid=first-secret' -H 'Cookie: pref=second-secret' https://example.test"
    const redacted = "curl -H 'Cookie: sid=[redacted]' -H 'Cookie: pref=[redacted]' https://example.test"
    expect(Env.redactSecrets(request)).toBe(redacted)
    expect(Env.redactSecrets(redacted)).toBe(redacted)

    const response = "curl -H 'Set-Cookie: sid=first-secret; Path=/' -H 'Set-Cookie: pref=second-secret; Secure'"
    expect(Env.redactSecrets(response)).toBe(
      "curl -H 'Set-Cookie: sid=[redacted]; Path=/' -H 'Set-Cookie: pref=[redacted]; Secure'",
    )
  })

  test("redacts malformed quoted cookie names instead of treating them as complete values", () => {
    const request = 'Cookie: "sid" = first-secret; pref=second-secret'
    const redacted = 'Cookie: "sid"=[redacted]; pref=[redacted]'
    expect(Env.redactSecrets(request)).toBe(redacted)
    expect(Env.redactSecrets(redacted)).toBe(redacted)
    expect(Env.redactSecrets("curl -H 'Cookie: \"sid\"=first-secret; pref=second-secret'")).toBe(
      "curl -H 'Cookie: \"sid\"=[redacted]; pref=[redacted]'",
    )
  })

  test("does not stop at a quote that only looked like the value close", () => {
    // A nested quoted value inside an enclosing logfmt or shell quote must not
    // truncate the span: every later pair has to be redacted too.
    const logfmt = 'level=error msg="auth failed, Cookie: zz="q$w"; sid=SECRET123"'
    const logfmtRedacted = 'level=error msg="auth failed, Cookie: zz=[redacted]"; sid=[redacted]'
    expect(Env.redactSecrets(logfmt)).toBe(logfmtRedacted)
    expect(Env.redactSecrets(logfmtRedacted)).toBe(logfmtRedacted)

    expect(Env.redactSecrets('level=error msg="Cookie: zz = "q$w"; sid=SECRET123"')).toBe(
      'level=error msg="Cookie: zz=[redacted]"; sid=[redacted]',
    )
    // An apostrophe inside a shell-quoted value has the same effect.
    expect(Env.redactSecrets("curl -H 'Cookie: zz=O'Brien; sid=SECRET123'")).toBe("curl -H 'Cookie: zz=[redacted]'")
  })

  test("redacts comma-joined repeated and CRLF-folded cookie headers", () => {
    // Some log sinks join repeated headers with ", ", so a second Set-Cookie
    // header begins mid-line and must still be split as a new pair.
    const joined = "Set-Cookie: zz=SECRET123; Path=/, Set-Cookie: yy=SECRET456; Path=/"
    const joinedRedacted = "Set-Cookie: zz=[redacted]; Path=/, Set-Cookie: yy=[redacted]; Path=/"
    expect(Env.redactSecrets(joined)).toBe(joinedRedacted)
    expect(Env.redactSecrets(joinedRedacted)).toBe(joinedRedacted)

    // An obs-fold continuation belongs to the same header and must be redacted.
    const folded = "Cookie: zz=SECRET123\r\n yy=SECRET456"
    const foldedRedacted = "Cookie: zz=[redacted]\r\n yy=[redacted]"
    expect(Env.redactSecrets(folded)).toBe(foldedRedacted)
    expect(Env.redactSecrets(foldedRedacted)).toBe(foldedRedacted)
  })

  test("redacts curl cookie flag values but leaves a cookie file argument", () => {
    expect(Env.redactSecrets("curl -b 'session=zz1' https://x")).toBe("curl -b 'session=[redacted]' https://x")
    expect(Env.redactSecrets('curl --cookie "a=zz1; b=zz2" https://x')).toBe(
      'curl --cookie "a=[redacted]; b=[redacted]" https://x',
    )
    // A cookie *file* argument is not a pair and must survive.
    expect(Env.redactSecrets("curl -b cookies.txt https://x")).toBe("curl -b cookies.txt https://x")
    // Still idempotent once redacted.
    const once = Env.redactSecrets("curl -b 'session=zz1' https://x")
    expect(Env.redactSecrets(once)).toBe(once)
  })

  test.each([
    ["curl -bsid=fixture-secret https://example.test", "curl -bsid=[redacted] https://example.test"],
    ['curl -b"sid=fixture-secret" https://example.test', 'curl -b"sid=[redacted]" https://example.test'],
    [
      'curl --cookie sid=fixture-one"fixture-two" https://example.test',
      "curl --cookie sid=[redacted] https://example.test",
    ],
    ["curl -b 'sid='fixture-secret https://example.test", "curl -b sid=[redacted] https://example.test"],
    [
      'curl --cookie "sid=fixture-one\\\"fixture-two; pref=fixture-three" https://example.test',
      'curl --cookie "sid=[redacted]" https://example.test',
    ],
    [
      'curl --cookie "sid=fixture-one\\;fixture-two; pref=fixture-three" https://example.test',
      'curl --cookie "sid=[redacted];[redacted]; pref=[redacted]" https://example.test',
    ],
    ["true;curl -bsid=fixture-secret&&echo done", "true;curl -bsid=[redacted]&&echo done"],
  ])("redacts the entire literal curl cookie word: %s", (input, expected) => {
    expect(Env.redactSecrets(input)).toBe(expected)
    expect(Env.redactForRecord(input)).toBe(expected)
    expect(Env.redactSecrets(expected)).toBe(expected)
  })

  test("preserves shell-quoted cookie filenames and unrelated long flags", () => {
    for (const input of [
      'curl -b"cookie file.txt" https://example.test',
      "curl --cookie cookie\\ file.txt https://example.test",
      "curl --cookie-jar 'output=jar.txt' https://example.test",
    ]) {
      expect(Env.redactSecrets(input)).toBe(input)
    }
  })

  test("conservatively redacts complex or unfinished curl cookie arguments", () => {
    for (const input of [
      "curl -b sid=$(printf fixture-secret) https://example.test",
      'curl --cookie "sid=${MISSING:-fixture-secret value}" https://example.test',
      'curl --cookie "sid=fixture-secret https://example.test',
    ]) {
      const redacted = Env.redactSecrets(input)
      expect(redacted).not.toContain("fixture-secret")
      expect(Env.redactSecrets(redacted)).toBe(redacted)
    }
  })

  test("redactForRecord composes both passes without doubling the placeholder", () => {
    // Order is fixed inside the helper: an assignment to a keyword-named key is
    // redacted once, not re-matched into `[redacted]]`.
    expect(Env.redactForRecord("API_KEY=placeholder-token-value ./run")).toBe("API_KEY=[redacted] ./run")
    expect(Env.redactForRecord("TOKEN=abc123")).toBe("TOKEN=[redacted]")
    // Header, flag, and URI credentials are covered by the same call.
    expect(Env.redactForRecord('curl -H "Authorization: Bearer sk-x" https://api')).toContain(
      "Authorization: [redacted]",
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

describe("record credential coverage", () => {
  test.each(["sk-proj-", "sk-ant-api03-"])("redacts complete hyphenated provider keys: %s", (prefix) => {
    const value = prefix + "A".repeat(24) + "-" + "B".repeat(24) + "_" + "C".repeat(24)
    expect(Env.redactForRecord(`Provider rejected ${value}. Retry later.`)).toBe(
      "Provider rejected [redacted secret]. Retry later.",
    )
  })
  test.each([
    "access_token",
    "refresh_token",
    "id_token",
    "client_secret",
    "auth",
    "bearer",
    "credentials",
    "private_key",
    "x-api-key",
    "pat",
    "webhook",
  ])("redacts structured credential spelling %s in record strings", (key) => {
    expect(Env.isCredentialKeyName(key)).toBe(true)
    expect(Env.redactForRecord(JSON.stringify({ [key]: "opaque-value", tokenCount: 12 }))).not.toContain("opaque-value")
    expect(Env.redactForRecord(`${key}: opaque-value`)).not.toContain("opaque-value")
    expect(Env.redactForRecord('{"tokenCount":12,"keyboard":"safe"}')).toBe('{"tokenCount":12,"keyboard":"safe"}')
  })
  test("quoted secrets can contain the opposite quote", () => {
    expect(Env.redactForRecord(JSON.stringify({ password: "one'two" }))).toBe('{"password":"[redacted]"}')
  })
})

test.each([
  { credentials: { user: "alice", pass: "opaque-value" }, keep: true },
  { password: ["opaque-value", { nested: "another-value" }], keep: true },
  { password: 123456, keep: true },
  { auth: [{ nested: { text: 'brackets } ] and "quotes"' } }], keep: true },
])("redacts complete non-string JSON credential values %#", (record) => {
  const result = Env.redactForRecord(JSON.stringify(record))
  const key = Object.keys(record)[0]!
  expect(result).toBe(JSON.stringify({ [key]: "[redacted]", keep: true }))
  expect(Env.redactForRecord(result)).toBe(result)
})

test("redacts a truncated quoted JSON credential through the end of the record", () => {
  expect(Env.redactForRecord('{"password":"opaque-value')).not.toContain("opaque-value")
})

test.each(["https://opaque-value@example.com/path", "redis://opaque-value@localhost:6379/0"])(
  "redacts username-only URI credentials %s",
  (url) => {
    const result = Env.redactForRecord(url)
    expect(result).not.toContain("opaque-value")
    expect(result).toContain("[redacted]@")
    expect(Env.redactForRecord(result)).toBe(result)
  },
)

test("URL fragment credentials are excluded from child env and redacted in records", () => {
  const url = "https://example.com/callback#access_token=opaque-value&state=public"
  expect(Env.sanitize({ CALLBACK: url }).CALLBACK).toBeUndefined()
  const result = Env.redactForRecord(url)
  expect(result).not.toContain("opaque-value")
  expect(result).toContain("state=public")
  expect(Env.sanitize({ CALLBACK: "https://example.com/#section=public" }).CALLBACK).toBe(
    "https://example.com/#section=public",
  )
})

test("many orphan private-key markers finish in bounded time", () => {
  const source = fileURLToPath(new URL("../../src/util/env.ts", import.meta.url))
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import { Env } from ${JSON.stringify(source)};
    const header = "-----" + "BEGIN PRIVATE KEY" + "-----";
    const text = (header + "\\n" + "A".repeat(32) + "\\n").repeat(64000);
    console.log(Env.redactForRecord(text));
  `,
    ],
    { encoding: "utf8", timeout: 3000, maxBuffer: 20000 },
  )
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(0)
  expect(result.stdout.trim()).toBe("[redacted private key]")
})

test.each(["MYSQL_PWD", "PGPASSFILE", "SSH_ASKPASS"])("strips credential environment alias %s", (name) => {
  expect(Env.sanitize({ [name]: "opaque-credential", PWD: "/workspace", PATH: "/bin" })).toEqual({
    PWD: "/workspace",
    PATH: "/bin",
  })
})

test("redacts fused private-key blocks that share their separator dashes", () => {
  const header = "-----" + "BEGIN PRIVATE KEY" + "-----"
  const footer = "-----END PRIVATE KEY-----"
  const input = `public\n${header}\nFIRST_BODY\n${footer}${header.slice(5)}\nSECOND_BODY\n${footer}\npublic tail`
  const result = Env.redactForRecord(input)
  expect(result).not.toContain("FIRST_BODY")
  expect(result).not.toContain("SECOND_BODY")
  expect(result).toContain("public tail")
})

test.each(["jdbc:postgresql://app:opaque@db.test/prod", "jdbc:mysql://app:opaque@db.test/prod"])(
  "strips nested URI userinfo: %s",
  (url) => {
    expect(Env.sanitize({ APP_DSN: url }).APP_DSN).toBeUndefined()
    expect(Env.redactInlineEnvAssignments(`APP_DSN=${url} run`)).toBe("APP_DSN=[redacted] run")
  },
)

test.each(["password=first&second", "client_secret: first&second"])(
  "redacts complete bare credentials containing ampersands: %s",
  (input) => {
    const result = Env.redactSecrets(input)
    expect(result).not.toContain("first")
    expect(result).not.toContain("second")
  },
)

test("preserves public query siblings while redacting multiple credential parameters", () => {
  expect(Env.redactSecrets("https://example.test/?vendor-password=first&auth=second&format=raw")).toBe(
    "https://example.test/?vendor-password=[redacted]&auth=[redacted]&format=raw",
  )
})

test("preserves public query siblings after empty credential parameters", () => {
  expect(Env.redactSecrets("https://example.test/?password=&auth=&format=raw")).toBe(
    "https://example.test/?password=[redacted]&auth=[redacted]&format=raw",
  )
})

test.each([
  "my_cookie: opaque-value",
  "db_password: opaque-value",
  '{"db_password":"opaque-value"}',
  '{"my_private_key":["opaque-value"]}',
])("redacts credential keys with separator prefixes: %s", (input) => {
  expect(Env.redactForRecord(input)).not.toContain("opaque-value")
})

test("shares prefixed credential names with structured redaction without matching public suffixes", () => {
  for (const name of ["DB_PASSWORD", "my_private_key", "bearer_token", "db.password"]) {
    expect(Env.isCredentialKeyName(name)).toBe(true)
  }
  for (const name of ["keyboard", "monkey", "tokenCount", "db_password_length", "my_token_count"]) {
    expect(Env.isCredentialKeyName(name)).toBe(false)
  }
})

test("long public scheme-like words finish redaction in bounded time", () => {
  const moduleURL = new URL("../../src/util/env.ts", import.meta.url).href
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import { Env } from ${JSON.stringify(moduleURL)};
    const value = "a-".repeat(64000) + "public=value";
    if (Env.redactForRecord(value) !== value) throw new Error("public value changed");
    if (Env.redactInlineEnvAssignments("REF=" + value + " run") !== "REF=" + value + " run") throw new Error("public assignment changed");
    const separators = "?".repeat(64000) + "public=value";
    if (Env.redactForRecord(separators) !== separators) throw new Error("public separators changed");
    console.log("preserved");
  `,
    ],
    { cwd: fileURLToPath(new URL("../../../../", import.meta.url)), encoding: "utf8", timeout: 3000 },
  )
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(0)
  expect(result.stdout.trim()).toBe("preserved")
})

test("preserves the public fragment after a query credential", () => {
  expect(Env.redactSecrets("https://example.test/?token=opaque#section")).toBe(
    "https://example.test/?token=[redacted]#section",
  )
})

test("redacts hash characters inside an ordinary bare credential value", () => {
  expect(Env.redactSecrets("token=first#second")).toBe("token=[redacted]")
})

test.each(["api.key", "private.key", "x.api.key"])("redacts dot-separated compound credential names: %s", (name) => {
  expect(Env.isCredentialKeyName(name)).toBe(true)
  expect(Env.redactForRecord(`${name}=opaque-value`)).toBe(`${name}=[redacted]`)
  expect(Env.redactForRecord(JSON.stringify({ [name]: "opaque-value", public: "keep" }))).toBe(
    JSON.stringify({ [name]: "[redacted]", public: "keep" }),
  )
})

test.each([
  "auth",
  "bearer",
  "private.key",
  "api.key",
  "client_secret",
  "refresh_token",
  "%74oken",
  "api%2Ekey",
  "access.key",
  "access%2Ekey",
])("shares decoded credential query names across env and record boundaries: %s", (name) => {
  for (const separator of ["?", "#"]) {
    const url = `https://example.test/${separator}${name}=opaque-value&format=raw`
    expect(Env.sanitize({ CALLBACK: url })).toEqual({})
    expect(Env.redactForRecord(url)).toBe(`https://example.test/${separator}${name}=[redacted]&format=raw`)
  }
})

test("redacts nested raw query credentials inside a public parameter value", () => {
  const url = "https://example.test/?redirect=https://inner.test/?token=opaque&format=raw"
  expect(Env.redactForRecord(url)).toBe(
    "https://example.test/?redirect=https://inner.test/?token=[redacted]&format=raw",
  )
  expect(Env.sanitize({ CALLBACK: url })).toEqual({})
})

test.each(["access_key", "access.key", "secret_access_key"])(
  "redacts access-key fields consistently with URL credentials: %s",
  (name) => {
    expect(Env.isCredentialKeyName(name)).toBe(true)
    expect(Env.redactForRecord(JSON.stringify({ [name]: "opaque-value", public: "keep" }))).toBe(
      JSON.stringify({ [name]: "[redacted]", public: "keep" }),
    )
  },
)

test.each(["mytoken", "secretAccessKey", "myApiKey"])(
  "shares camelCase and undelimited credential names across boundaries: %s",
  (name) => {
    expect(Env.isCredentialKeyName(name)).toBe(true)
    expect(Env.redactForRecord(JSON.stringify({ [name]: "opaque-value", public: "keep" }))).toBe(
      JSON.stringify({ [name]: "[redacted]", public: "keep" }),
    )
    const url = `https://example.test/?${name}=opaque-value&format=raw`
    expect(Env.sanitize({ CALLBACK: url })).toEqual({})
    expect(Env.redactForRecord(url)).toBe(`https://example.test/?${name}=[redacted]&format=raw`)
  },
)

test("keeps compatibility fields public while redacting delimited personal access tokens", () => {
  expect(Env.isCredentialKeyName("compat")).toBe(false)
  expect(Env.isCredentialKeyName("my_pat")).toBe(true)
  expect(Env.redactForRecord('{"compat":"legacy","my_pat":"opaque-value"}')).toBe(
    '{"compat":"legacy","my_pat":"[redacted]"}',
  )
  const url = "https://example.test/?compat=legacy"
  expect(Env.redactForRecord(url)).toBe(url)
  expect(Env.sanitize({ CALLBACK: url })).toEqual({ CALLBACK: url })
})

test.each(["secretKey", "SECRET_KEY", "my_secret_key", "AUTH_KEY", "authKey", "token.key"])(
  "hides credential key suffix %s across structured records and URL parameters",
  (key) => {
    expect(Env.isCredentialKeyName(key)).toBe(true)
    expect(Env.redactForRecord(JSON.stringify({ [key]: "opaque-value", public: "keep" }))).toBe(
      JSON.stringify({ [key]: "[redacted]", public: "keep" }),
    )
    const url = `https://example.test/?${key}=opaque-value&public=keep`
    expect(Env.redactForRecord(url)).toBe(`https://example.test/?${key}=[redacted]&public=keep`)
    expect(Env.sanitize({ CALLBACK: url })).toEqual({})
  },
)

test.each([
  "Token opaque-value",
  "ApiKey opaque-value",
  'Digest username="alice", nonce="opaque-value", response="opaque-proof"',
])("hides the complete Authorization header with credentials %s", (credentials) => {
  expect(Env.redactForRecord(`Authorization: ${credentials}\r\nAccept: application/json`)).toBe(
    "Authorization: [redacted]\r\nAccept: application/json",
  )
  expect(Env.redactForRecord(`curl -H 'Authorization: ${credentials}' https://example.test`)).toBe(
    "curl -H 'Authorization: [redacted]' https://example.test",
  )
  const redacted = Env.redactForRecord(`curl -H 'Authorization: ${credentials}' https://example.test`)
  expect(Env.redactForRecord(redacted)).toBe(redacted)
})

test("hides folded and proxy authentication headers while preserving enclosing record boundaries", () => {
  expect(Env.redactForRecord("Proxy-Authorization: Token opaque-value\r\n continued-secret\r\nAccept: json")).toBe(
    "Proxy-Authorization: [redacted]\r\nAccept: json",
  )
  expect(Env.redactForRecord('level=error msg="Authorization: Token opaque-value" public=keep')).toBe(
    'level=error msg="Authorization: [redacted]" public=keep',
  )
})

test("many quoted authentication headers finish within a bounded process lifetime", () => {
  const moduleURL = new URL("../../src/util/env.ts", import.meta.url).href
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
      import { Env } from ${JSON.stringify(moduleURL)};
      const value = "curl " + "-H 'Authorization: Token opaque-value' ".repeat(16000) + "https://example.test";
      const redacted = Env.redactForRecord(value);
      if (redacted.includes("opaque-value")) throw new Error("credential survived");
      if (!redacted.endsWith("https://example.test")) throw new Error("public URL changed");
      if (Env.redactForRecord(redacted) !== redacted) throw new Error("redaction was not idempotent");
      console.log("preserved");
    `,
    ],
    { cwd: fileURLToPath(new URL("../../../../", import.meta.url)), encoding: "utf8", timeout: 3000 },
  )
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(0)
  expect(result.stdout.trim()).toBe("preserved")
})

test.each([
  'curl -H "Authorization: Digest username="alice", nonce="opaque-value", response="opaque-proof"" https://example.test',
  'level=error msg="Authorization: Digest username="alice", nonce="opaque-value", response="opaque-proof"" public=keep',
  `curl -H 'Authorization: Digest username="O'Brien", nonce="opaque-value"' https://example.test`,
])("redacts nested authentication parameter quotes without exposing later parameters: %s", (value) => {
  const redacted = Env.redactForRecord(value)
  expect(redacted).not.toContain("opaque-value")
  expect(redacted).not.toContain("opaque-proof")
  expect(redacted).not.toContain("alice")
  expect(redacted).not.toContain("O'Brien")
  expect(redacted).toContain(value.endsWith("public=keep") ? "public=keep" : "https://example.test")
  expect(Env.redactForRecord(redacted)).toBe(redacted)
})
