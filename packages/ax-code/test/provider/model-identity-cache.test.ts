import { scryptSync } from "node:crypto"
import { beforeEach, expect, test, vi } from "vitest"

vi.mock("node:crypto", async (importOriginal) => {
  const crypto = await importOriginal<typeof import("node:crypto")>()
  return { ...crypto, scryptSync: vi.fn(() => Buffer.alloc(32)) }
})

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

function model(password: string) {
  return {
    id: "model",
    providerID: "gateway",
    api: {
      id: "upstream",
      url: `https://user:${password}@gateway.example/v1`,
      npm: "@ai-sdk/openai-compatible",
    },
  }
}

test("credential rotation evicts old secrets without changing recomputed identities", async () => {
  const { resolveModelIdentity } = await import("../../src/provider/model-identity")
  const original = resolveModelIdentity(model("first"))
  expect(resolveModelIdentity(model("first"))).toEqual(original)
  expect(scryptSync).toHaveBeenCalledTimes(1)
  for (let i = 0; i < 1_000; i++) resolveModelIdentity(model(`rotated-${i}`))
  const calls = vi.mocked(scryptSync).mock.calls.length
  expect(resolveModelIdentity(model("first"))).toEqual(original)
  expect(scryptSync).toHaveBeenCalledTimes(calls + 1)
})

test("credential stretching failures surface rather than falling back to a fast secret hash", async () => {
  const { resolveModelIdentity } = await import("../../src/provider/model-identity")
  vi.mocked(scryptSync).mockImplementationOnce(() => {
    throw new Error("credential stretching failed")
  })
  expect(() => resolveModelIdentity(model("secret"))).toThrow("credential stretching failed")
})
