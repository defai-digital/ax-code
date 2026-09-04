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

  test("forwards CLI provider API keys only through explicit CLI provider overlay", () => {
    const originalGemini = process.env.GEMINI_API_KEY
    const originalOpenAI = process.env.OPENAI_API_KEY
    const originalAnthropic = process.env.ANTHROPIC_API_KEY
    const originalXai = process.env.XAI_API_KEY
    const originalKimi = process.env.KIMI_API_KEY

    try {
      process.env.GEMINI_API_KEY = "gemini-key"
      process.env.OPENAI_API_KEY = "openai-key"
      process.env.ANTHROPIC_API_KEY = "anthropic-key"
      process.env.XAI_API_KEY = "xai-key"
      process.env.KIMI_API_KEY = "kimi-key"

      const env = Env.withCliProviderKeys(Env.sanitize({ PATH: "/bin" }), "codex-cli")

      expect(env.PATH).toBe("/bin")
      expect(env.OPENAI_API_KEY).toBe("openai-key")
      expect(env.GEMINI_API_KEY).toBeUndefined()
      expect(env.ANTHROPIC_API_KEY).toBeUndefined()
      expect(env.XAI_API_KEY).toBeUndefined()
      expect(env.KIMI_API_KEY).toBeUndefined()
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
    }
  })
})
