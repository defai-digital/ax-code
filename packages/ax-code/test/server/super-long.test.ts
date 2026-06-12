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

  test("honors the AX_CODE_SUPER_LONG base env, matching runtime precedence", async () => {
    await withCleanSuperLongEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      // Non-Qwen model: the model default is off, so only the base env can enable
      // it here (no session override set). The runtime readers honor this base
      // env, so GET must too.
      await Bun.write(path.join(tmp.path, "ax-code.json"), JSON.stringify({ model: "anthropic/claude-opus-4-8" }))
      process.env.AX_CODE_SUPER_LONG = "true"

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const response = await Server.Default().request(`/super-long?directory=${encodeURIComponent(tmp.path)}`)
          expect(response.status).toBe(200)
          expect(await response.json()).toEqual({ enabled: true })
        },
      })
    })
  })

  test("base env false overrides the Qwen3.7-Max model default", async () => {
    await withCleanSuperLongEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      await Bun.write(path.join(tmp.path, "ax-code.json"), JSON.stringify({ model: "alibaba-coding-plan/qwen3.7-max" }))
      process.env.AX_CODE_SUPER_LONG = "false"

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

  test("uses explicit query model when project config has no model", async () => {
    await withCleanSuperLongEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      await Bun.write(path.join(tmp.path, "ax-code.json"), JSON.stringify({}))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const model = encodeURIComponent("alibaba-coding-plan/qwen3.7-max")
          const response = await Server.Default().request(
            `/super-long?directory=${encodeURIComponent(tmp.path)}&model=${model}`,
          )
          expect(response.status).toBe(200)
          expect(await response.json()).toEqual({ enabled: true })
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
            name: "ServiceUnavailableError",
            message: "Super-Long requires autonomous mode or equivalent runtime guardrails.",
            status: 409,
            retryable: true,
            details: { resource: "superLong" },
          })
          expect(process.env[OVERRIDE]).toBeUndefined()
        },
      })
    })
  })

  test("status reports duration from object config and per-session timing", async () => {
    await withCleanSuperLongEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      const storePath = path.join(tmp.path, "super-long-runtime.json")
      const previousStore = process.env.AX_CODE_SUPER_LONG_RUNTIME_STORE
      process.env.AX_CODE_SUPER_LONG_RUNTIME_STORE = storePath
      try {
        await Bun.write(
          path.join(tmp.path, "ax-code.json"),
          JSON.stringify({
            model: "anthropic/claude-opus-4-8",
            super_long: { enabled: true, duration_hours: 2 },
          }),
        )
        const startedAt = Date.now() - 60_000
        await Bun.write(
          storePath,
          JSON.stringify({ runs: { ses_status_test: { startedAt, lastSeenAt: startedAt } } }),
        )

        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const response = await Server.Default().request(
              `/super-long/status?directory=${encodeURIComponent(tmp.path)}&sessionID=ses_status_test`,
            )
            expect(response.status).toBe(200)
            const body = (await response.json()) as {
              enabled: boolean
              source: string
              durationMs: number | null
              startedAt: number | null
              elapsedMs: number | null
              remainingMs: number | null
            }
            expect(body.enabled).toBe(true)
            expect(body.source).toBe("config")
            expect(body.durationMs).toBe(2 * 60 * 60 * 1000)
            expect(body.startedAt).toBe(startedAt)
            expect(body.elapsedMs).toBeGreaterThanOrEqual(60_000)
            expect(body.remainingMs).toBeLessThanOrEqual(2 * 60 * 60 * 1000 - 60_000)
            expect(body.remainingMs).toBeGreaterThan(0)
          },
        })
      } finally {
        if (previousStore === undefined) delete process.env.AX_CODE_SUPER_LONG_RUNTIME_STORE
        else process.env.AX_CODE_SUPER_LONG_RUNTIME_STORE = previousStore
      }
    })
  })

  test("status reports null timing when the session has no durable run", async () => {
    await withCleanSuperLongEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      await Bun.write(path.join(tmp.path, "ax-code.json"), JSON.stringify({ model: "anthropic/claude-opus-4-8" }))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const response = await Server.Default().request(`/super-long/status?directory=${encodeURIComponent(tmp.path)}`)
          expect(response.status).toBe(200)
          expect(await response.json()).toEqual({
            enabled: false,
            source: "model-default",
            durationMs: 72 * 60 * 60 * 1000,
            startedAt: null,
            elapsedMs: null,
            remainingMs: null,
          })
        },
      })
    })
  })

  test("disabling autonomous prevents a session Super-Long override from reviving", async () => {
    await withCleanSuperLongEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      await Bun.write(path.join(tmp.path, "ax-code.json"), JSON.stringify({ autonomous: true }))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const directoryQuery = `directory=${encodeURIComponent(tmp.path)}`
          const enabled = await Server.Default().request(`/super-long?${directoryQuery}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: true }),
          })
          expect(enabled.status).toBe(200)
          expect(await enabled.json()).toEqual({ enabled: true })

          const autonomousOff = await Server.Default().request(`/autonomous?${directoryQuery}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: false }),
          })
          expect(autonomousOff.status).toBe(200)
          expect(await autonomousOff.json()).toEqual({ enabled: false })
          expect(process.env[OVERRIDE]).toBe("false")

          const autonomousOn = await Server.Default().request(`/autonomous?${directoryQuery}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: true }),
          })
          expect(autonomousOn.status).toBe(200)
          expect(await autonomousOn.json()).toEqual({ enabled: true })

          const superLong = await Server.Default().request(`/super-long?${directoryQuery}`)
          expect(superLong.status).toBe(200)
          expect(await superLong.json()).toEqual({ enabled: false })
        },
      })
    })
  })
})
