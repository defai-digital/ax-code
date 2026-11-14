import { describe, expect, test } from "vitest"
import { configurationKey, resolveModelIdentity } from "../../src/provider/model-identity"

const model = {
  id: "display-alias",
  providerID: "gateway",
  api: { id: "upstream-model", url: "https://gateway.example/tenant-a/v1", npm: "@ai-sdk/openai-compatible" },
}

describe("resolved model identity", () => {
  test("configuration type tags cannot collide and model contracts invalidate cached compilers", () => {
    expect(configurationKey("sdk", { value: undefined })).not.toBe(configurationKey("sdk", { value: ["undefined"] }))
    expect(configurationKey("sdk", { value: NaN })).not.toBe(configurationKey("sdk", { value: null }))
    const first = resolveModelIdentity({ ...model, capabilities: { toolcall: true }, limit: { output: 4000 } })
    const second = resolveModelIdentity({ ...model, capabilities: { toolcall: false }, limit: { output: 8000 } })
    expect(first.deploymentKey).toBe(second.deploymentKey)
    expect(first.languageKey).not.toBe(second.languageKey)
  })
  test("display aliases do not change deployment or language identity", () => {
    const first = resolveModelIdentity(model)
    const second = resolveModelIdentity({ ...model, id: "another-alias" })
    expect(second.deploymentKey).toBe(first.deploymentKey)
    expect(second.languageKey).toBe(first.languageKey)
    expect(second.selection).not.toEqual(first.selection)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.deployment)).toBe(true)
  })

  test.each(["@ai-sdk/openai-compatible", "@ai-sdk/openai", "@ai-sdk/anthropic"])(
    "separates deployment paths for %s",
    (npm) => {
      const first = resolveModelIdentity({ ...model, api: { ...model.api, npm } })
      const other = resolveModelIdentity({
        ...model,
        api: { ...model.api, npm, url: "https://gateway.example/tenant-b/v1" },
      })
      expect(other.deploymentKey).not.toBe(first.deploymentKey)
      expect(other.languageKey).not.toBe(first.languageKey)
    },
  )

  test("normalizes URL spellings and keeps protocol and upstream model distinct", () => {
    const first = resolveModelIdentity(model)
    expect(
      resolveModelIdentity({ ...model, api: { ...model.api, url: "https://GATEWAY.example:443/tenant-a/v1/" } })
        .deploymentKey,
    ).toBe(first.deploymentKey)
    expect(resolveModelIdentity({ ...model, api: { ...model.api, npm: "@ai-sdk/openai" } }).deploymentKey).not.toBe(
      first.deploymentKey,
    )
    expect(resolveModelIdentity({ ...model, api: { ...model.api, id: "other-upstream" } }).deploymentKey).not.toBe(
      first.deploymentKey,
    )
  })

  test("routes query parameters without disclosing their values or URL credentials", () => {
    const result = resolveModelIdentity({
      ...model,
      api: { ...model.api, url: "https://user:password@gateway.example/v1?key=private-value" },
    })
    expect(JSON.stringify(result)).not.toMatch(/password|private-value/)
    expect(result.deploymentKey.startsWith("deployment-v2:")).toBe(true)
    expect(result.deploymentKey).not.toMatch(/^deployment-v2:[a-f0-9]{64}$/)
    expect(
      resolveModelIdentity({
        ...model,
        api: { ...model.api, url: "https://user:password@gateway.example/v1?key=other-value" },
      }).deploymentKey,
    ).not.toBe(result.deploymentKey)
    expect(
      resolveModelIdentity({
        ...model,
        api: { ...model.api, url: "https://user:other-secret@gateway.example/v1?key=private-value" },
      }).deploymentKey,
    ).not.toBe(result.deploymentKey)
  })

  test("connection credentials, callbacks and headers have distinct cache scopes", () => {
    const first = resolveModelIdentity(model, { apiKey: "first" })
    const second = resolveModelIdentity(model, { apiKey: "second" })
    expect(second.deploymentKey).toBe(first.deploymentKey)
    expect(second.languageKey).not.toBe(first.languageKey)
    expect(resolveModelIdentity({ ...model, headers: { "x-route": "other" } }).languageKey).not.toBe(first.languageKey)
    expect(configurationKey("sdk", { fetch: () => {} })).not.toBe(configurationKey("sdk", { fetch: () => {} }))
    const callback = () => {}
    expect(configurationKey("sdk", { b: 2, fetch: callback, a: 1 })).toBe(
      configurationKey("sdk", { a: 1, b: 2, fetch: callback }),
    )
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(configurationKey("sdk", cyclic)).toBe(configurationKey("sdk", cyclic))
  })
})
