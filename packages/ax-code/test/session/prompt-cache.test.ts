import { describe, expect, test } from "vitest"
import { resolvePromptCache } from "../../src/session/prompt-cache"

describe("resolvePromptCache", () => {
  test("reuses cached values when keys match", async () => {
    let loads = 0
    const cached = { key: "agent:build", value: { name: "build" } }

    const result = await resolvePromptCache({
      cache: cached,
      key: "agent:build",
      load: async () => {
        loads++
        return { name: "loaded" }
      },
    })

    expect(result.value).toBe(cached.value)
    expect(result.cache).toBe(cached)
    expect(loads).toBe(0)
  })

  test("loads and returns a new cache entry when keys differ", async () => {
    let loads = 0

    const result = await resolvePromptCache({
      cache: { key: "agent:build", value: { name: "build" } },
      key: "agent:plan",
      load: async () => {
        loads++
        return { name: "plan" }
      },
    })

    expect(result.value).toEqual({ name: "plan" })
    expect(result.cache).toEqual({ key: "agent:plan", value: { name: "plan" } })
    expect(loads).toBe(1)
  })
})
