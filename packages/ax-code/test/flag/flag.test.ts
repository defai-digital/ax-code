import { afterEach, expect, test } from "bun:test"
import { Flag } from "../../src/flag/flag"

const originalConfigContent = process.env["AX_CODE_CONFIG_CONTENT"]
const originalModelsPath = process.env["AX_CODE_MODELS_PATH"]
const originalModelsUrl = process.env["AX_CODE_MODELS_URL"]

afterEach(() => {
  restoreEnv("AX_CODE_CONFIG_CONTENT", originalConfigContent)
  restoreEnv("AX_CODE_MODELS_PATH", originalModelsPath)
  restoreEnv("AX_CODE_MODELS_URL", originalModelsUrl)
})

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

test("runtime config/model flags read process.env at access time", () => {
  process.env["AX_CODE_CONFIG_CONTENT"] = '{"username":"first"}'
  process.env["AX_CODE_MODELS_PATH"] = "/tmp/first-models.json"
  process.env["AX_CODE_MODELS_URL"] = "https://example.com/first-models.json"

  expect(Flag.AX_CODE_CONFIG_CONTENT).toBe('{"username":"first"}')
  expect(Flag.AX_CODE_MODELS_PATH).toBe("/tmp/first-models.json")
  expect(Flag.AX_CODE_MODELS_URL).toBe("https://example.com/first-models.json")

  process.env["AX_CODE_CONFIG_CONTENT"] = '{"username":"second"}'
  process.env["AX_CODE_MODELS_PATH"] = "/tmp/second-models.json"
  process.env["AX_CODE_MODELS_URL"] = "https://example.com/second-models.json"

  expect(Flag.AX_CODE_CONFIG_CONTENT).toBe('{"username":"second"}')
  expect(Flag.AX_CODE_MODELS_PATH).toBe("/tmp/second-models.json")
  expect(Flag.AX_CODE_MODELS_URL).toBe("https://example.com/second-models.json")
})
