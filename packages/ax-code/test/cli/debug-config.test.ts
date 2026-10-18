import { expect, test } from "vitest"
import { redactConfig } from "../../src/cli/cmd/debug/redact-config"

test("debug config masks nested credentials and executable config without mutating the input", () => {
  const secret = "synthetic-private-value"
  const config = {
    model: "provider/model",
    provider: { example: { options: { apiKey: secret, maxTokens: 4096, nested: [{ refreshToken: secret }] } } },
    mcp: { server: { environment: { CUSTOM_AUTH: secret }, command: ["server", secret], headers: { custom: secret } } },
    password: secret,
    credential: { value: secret },
    clientSecret: secret,
    accessKeyId: secret,
    token_id: secret,
    key: secret,
    token: secret,
    endpoint: `https://user:${secret}@example.com/api?custom=${secret}#${secret}`,
    mirror: `postgres://user:${secret}@example.com/database`,
    invalidUrl: `https://user:${secret}@invalid:port`,
    ordinary: [null, false, 123, "apiKey-model", "https://example.com/api"],
  }
  const original = structuredClone(config)
  const redacted = redactConfig(config)
  expect(JSON.stringify(redacted)).not.toContain(secret)
  expect(redacted).toMatchObject({
    model: "provider/model",
    provider: { example: { options: { apiKey: "[REDACTED]", maxTokens: 4096 } } },
    ordinary: config.ordinary,
  })
  expect(config).toEqual(original)
})
