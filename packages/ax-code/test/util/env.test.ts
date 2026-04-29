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

  test("preserves CLI provider API key env vars required by subprocess providers", () => {
    const sanitized = Env.sanitize({
      GEMINI_API_KEY: "gemini-key",
      OPENAI_API_KEY: "openai-key",
      ANTHROPIC_API_KEY: "anthropic-key",
    })

    expect(sanitized.GEMINI_API_KEY).toBe("gemini-key")
    expect(sanitized.OPENAI_API_KEY).toBe("openai-key")
    expect(sanitized.ANTHROPIC_API_KEY).toBeUndefined()
  })
})
