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
