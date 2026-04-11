import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { SmartLlmRoutes } from "../../src/server/routes/smart-llm"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const key = "AX_CODE_SMART_LLM"
const orig = process.env[key]

beforeEach(() => {
  if (orig === undefined) delete process.env[key]
  else process.env[key] = orig
})

afterEach(async () => {
  if (orig === undefined) delete process.env[key]
  else process.env[key] = orig
  await resetDatabase()
})

describe("smart-llm route", () => {
  test("preserves explicit env override on GET", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            routing: { llm: true },
          }),
        )
      },
    })
    process.env[key] = "false"
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const res = await SmartLlmRoutes().request("/")

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ enabled: false })
        expect(process.env[key]).toBe("false")
      },
    })
  })

  test("hydrates env from config when no override exists", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            routing: { llm: true },
          }),
        )
      },
    })
    delete process.env[key]
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const res = await SmartLlmRoutes().request("/")

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ enabled: true })
        expect(process.env[key]).toBe("true")
      },
    })
  })
})
