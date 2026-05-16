import { describe, expect, test } from "bun:test"
import { Env } from "../../src/util/env"

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
    expect(sanitized.SSH_AUTH_SOCK).toBe("/tmp/agent.sock")
    expect(sanitized.GIT_ASKPASS).toBe("/usr/bin/askpass")
    expect(sanitized.GIT_CREDENTIAL_HELPER).toBeUndefined()
  })

  test("strips provider API key env vars from general sanitized environments", () => {
    const sanitized = Env.sanitize({
      GEMINI_API_KEY: "gemini-key",
      OPENAI_API_KEY: "openai-key",
      ANTHROPIC_API_KEY: "anthropic-key",
    })

    expect(sanitized.GEMINI_API_KEY).toBeUndefined()
    expect(sanitized.OPENAI_API_KEY).toBeUndefined()
    expect(sanitized.ANTHROPIC_API_KEY).toBeUndefined()
  })

  test("forwards CLI provider API keys only through explicit CLI provider overlay", () => {
    const originalGemini = process.env.GEMINI_API_KEY
    const originalOpenAI = process.env.OPENAI_API_KEY
    const originalAnthropic = process.env.ANTHROPIC_API_KEY

    try {
      process.env.GEMINI_API_KEY = "gemini-key"
      process.env.OPENAI_API_KEY = "openai-key"
      process.env.ANTHROPIC_API_KEY = "anthropic-key"

      const env = Env.withCliProviderKeys(Env.sanitize({ PATH: "/bin" }))

      expect(env.PATH).toBe("/bin")
      expect(env.GEMINI_API_KEY).toBe("gemini-key")
      expect(env.OPENAI_API_KEY).toBe("openai-key")
      expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    } finally {
      if (originalGemini === undefined) delete process.env.GEMINI_API_KEY
      else process.env.GEMINI_API_KEY = originalGemini
      if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = originalOpenAI
      if (originalAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = originalAnthropic
    }
  })
})
