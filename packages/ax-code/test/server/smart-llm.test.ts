import { afterEach, describe, expect, test } from "vitest"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

const originalSmartLlm = process.env.AX_CODE_SMART_LLM

afterEach(() => {
  if (originalSmartLlm === undefined) delete process.env.AX_CODE_SMART_LLM
  else process.env.AX_CODE_SMART_LLM = originalSmartLlm
})

describe("smart LLM route", () => {
  test("does not inherit another project's process-global reconciliation", async () => {
    await using projectA = await tmpdir({ git: true })
    await using projectB = await tmpdir({ git: true })
    await writeFile(path.join(projectB.path, "ax-code.json"), "{}")

    await Instance.provide({
      directory: projectA.path,
      fn: async () => {
        const response = await Server.Default().request(`/smart-llm?directory=${encodeURIComponent(projectA.path)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true }),
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ enabled: true })
      },
    })

    await Instance.provide({
      directory: projectB.path,
      fn: async () => {
        const response = await Server.Default().request(`/smart-llm?directory=${encodeURIComponent(projectB.path)}`)
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ enabled: false })
      },
    })
  })
})
