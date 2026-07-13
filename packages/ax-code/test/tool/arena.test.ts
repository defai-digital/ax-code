import { describe, expect, test } from "vitest"
import { ArenaTool } from "../../src/tool/arena"
import { Arena } from "../../src/mode/arena"

describe("arena tool contract", () => {
  test("tool id is arena", () => {
    expect(ArenaTool.id).toBe("arena")
  })

  test("init exposes parameters", async () => {
    const init = await ArenaTool.init()
    expect(init.description.toLowerCase()).toContain("arena")
    expect(init.parameters.shape.task).toBeDefined()
    expect(init.parameters.shape.strategy).toBeDefined()
  })

  test("parameter schema requires task", async () => {
    const init = await ArenaTool.init()
    expect(() => init.parameters.parse({})).toThrow()
    const parsed = init.parameters.parse({ task: "Refactor auth" })
    expect(parsed.task).toBe("Refactor auth")
  })

  test("parameter schema accepts implement mode and enableIfDisabled", async () => {
    const init = await ArenaTool.init()
    const parsed = init.parameters.parse({
      task: "Add rate limiting",
      mode: "implement",
      strategy: "verify_first",
      enableIfDisabled: true,
    })
    expect(parsed.mode).toBe("implement")
    expect(parsed.strategy).toBe("verify_first")
    expect(parsed.enableIfDisabled).toBe(true)
  })

  test("explicit arena selection requires at least two unique members", async () => {
    const init = await ArenaTool.init()
    expect(() =>
      init.parameters.parse({
        task: "Compare implementations",
        providers: [{ providerID: "google", modelID: "gemini" }],
      }),
    ).toThrow()
    expect(() =>
      init.parameters.parse({
        task: "Compare implementations",
        providers: [
          { providerID: "google", modelID: "gemini" },
          { providerID: "google", modelID: "gemini" },
        ],
      }),
    ).toThrow()
    expect(() =>
      init.parameters.parse({
        task: "Compare implementations",
        providers: [
          { providerID: "google", modelID: "gemini-flash" },
          { providerID: "google", modelID: "gemini-pro" },
        ],
      }),
    ).toThrow()
  })
})

describe("arena ranking used by tool", () => {
  test("ranks injected plan candidates", () => {
    const ranked = Arena.rankArenaCandidates(
      [
        {
          id: "a/m",
          providerID: "a",
          modelID: "m",
          verification: "unknown",
          riskScore: 3,
          patchFingerprint: "fp1",
        },
        {
          id: "b/n",
          providerID: "b",
          modelID: "n",
          verification: "unknown",
          riskScore: 9,
          patchFingerprint: "fp2",
        },
      ],
      "diversity",
    )
    expect(ranked[0]!.id).toBe("a/m")
  })
})
