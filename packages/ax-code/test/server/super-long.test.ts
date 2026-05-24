import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

const OVERRIDE = "AX_CODE_SUPER_LONG_SESSION_OVERRIDE"

async function withCleanSuperLongEnv(fn: () => Promise<void>) {
  const previous = {
    superLong: process.env.AX_CODE_SUPER_LONG,
    override: process.env[OVERRIDE],
  }
  delete process.env.AX_CODE_SUPER_LONG
  delete process.env[OVERRIDE]
  try {
    await fn()
  } finally {
    if (previous.superLong === undefined) delete process.env.AX_CODE_SUPER_LONG
    else process.env.AX_CODE_SUPER_LONG = previous.superLong
    if (previous.override === undefined) delete process.env[OVERRIDE]
    else process.env[OVERRIDE] = previous.override
  }
}

describe("super-long route", () => {
  test("defaults on for Qwen3.7-Max when project config has no explicit setting", async () => {
    await withCleanSuperLongEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      await Bun.write(path.join(tmp.path, "ax-code.json"), JSON.stringify({ model: "alibaba-coding-plan/qwen3.7-max" }))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const response = await Server.Default().request(`/super-long?directory=${encodeURIComponent(tmp.path)}`)
          expect(response.status).toBe(200)
          expect(await response.json()).toEqual({ enabled: true })
          expect(process.env.AX_CODE_SUPER_LONG).toBeUndefined()
        },
      })
    })
  })

  test("does not default on when autonomous mode is disabled", async () => {
    await withCleanSuperLongEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      await Bun.write(
        path.join(tmp.path, "ax-code.json"),
        JSON.stringify({ model: "alibaba-coding-plan/qwen3.7-max", autonomous: false }),
      )

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const response = await Server.Default().request(`/super-long?directory=${encodeURIComponent(tmp.path)}`)
          expect(response.status).toBe(200)
          expect(await response.json()).toEqual({ enabled: false })
        },
      })
    })
  })

  test("session override wins over Qwen3.7-Max model default without rewriting config", async () => {
    await withCleanSuperLongEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      const configPath = path.join(tmp.path, "ax-code.json")
      const original = JSON.stringify({ model: "qwen3.7-max" })
      await Bun.write(configPath, original)

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const put = await Server.Default().request(`/super-long?directory=${encodeURIComponent(tmp.path)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: false }),
          })
          expect(put.status).toBe(200)
          expect(await put.json()).toEqual({ enabled: false })

          const get = await Server.Default().request(`/super-long?directory=${encodeURIComponent(tmp.path)}`)
          expect(await get.json()).toEqual({ enabled: false })
          expect(await Bun.file(configPath).text()).toBe(original)
        },
      })
    })
  })

  test("rejects enabling Super-Long when autonomous mode is disabled", async () => {
    await withCleanSuperLongEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      await Bun.write(path.join(tmp.path, "ax-code.json"), JSON.stringify({ model: "qwen3.7-max", autonomous: false }))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const response = await Server.Default().request(`/super-long?directory=${encodeURIComponent(tmp.path)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: true }),
          })
          expect(response.status).toBe(409)
          expect(await response.json()).toEqual({
            error: "Super-Long requires autonomous mode or equivalent runtime guardrails.",
          })
          expect(process.env[OVERRIDE]).toBeUndefined()
        },
      })
    })
  })
})
