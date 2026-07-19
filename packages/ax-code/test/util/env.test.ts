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

      const env = Env.withCliProviderKeys(Env.sanitize({ PATH: "/bin" }), "gemini-cli")

      expect(env.PATH).toBe("/bin")
      expect(env.GEMINI_API_KEY).toBe("gemini-key")
      expect(env.OPENAI_API_KEY).toBeUndefined()
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
