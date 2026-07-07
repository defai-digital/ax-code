import { describe, expect, test } from "vitest"
import path from "path"
import { writeFile, readFile } from "node:fs/promises"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"
import { Session } from "../../src/session"
import type { SessionID } from "../../src/session/schema"

const OVERRIDE = "AX_CODE_SUPER_LONG_SESSION_OVERRIDE"

async function withCleanSuperLongEnv(fn: () => Promise<void>) {
  const previous = {
    superLong: process.env.AX_CODE_SUPER_LONG,
    override: process.env[OVERRIDE],
    autonomous: process.env.AX_CODE_AUTONOMOUS,
  }
  delete process.env.AX_CODE_SUPER_LONG
  delete process.env[OVERRIDE]
  delete process.env.AX_CODE_AUTONOMOUS
  try {
    await fn()
  } finally {
    if (previous.superLong === undefined) delete process.env.AX_CODE_SUPER_LONG
    else process.env.AX_CODE_SUPER_LONG = previous.superLong
    if (previous.override === undefined) delete process.env[OVERRIDE]
    else process.env[OVERRIDE] = previous.override
    // Config loads with an explicit `autonomous` key sync the env flag, so
    // restore it to keep that from leaking across tests.
    if (previous.autonomous === undefined) delete process.env.AX_CODE_AUTONOMOUS
    else process.env.AX_CODE_AUTONOMOUS = previous.autonomous
  }
}

describe("super-long route", () => {
  test("defaults on for Qwen3.7-Max when project config has no explicit setting", async () => {
    await withCleanSuperLongEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      await writeFile(path.join(tmp.path, "ax-code.json"), JSON.stringify({ model: "alibaba-coding-plan/qwen3.7-max" }))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const response = await Server.Default().request(`/super-long?directory=${encodeURIComponent(tmp.path)}`)
          expect(response.status).toBe(200)
          expect(await response.json()).toEqual({ enabled: true })
          // GET reconciliation sets the base env to match the resolved
          // state so in-process readers (Flag.AX_CODE_SUPER_LONG) agree
          // with the UI. This is the correct reconciliation behavior.
          expect(process.env.AX_CODE_SUPER_LONG).toBe("true")
        },
      })
    })
  })

  test("config is the authority — base env does not override config for GET", async () => {
    await withCleanSuperLongEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      // Non-Qwen model with no explicit super_long in config. Even
      // though the base env says "true", the GET endpoint reconciles
      // from config (model default is off for non-Qwen), so the UI
      // sees false. The base env is then updated to match.
      await writeFile(path.join(tmp.path, "ax-code.json"), JSON.stringify({ model: "anthropic/claude-opus-4-8" }))
      process.env.AX_CODE_SUPER_LONG = "true"

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const response = await Server.Default().request(`/super-long?directory=${encodeURIComponent(tmp.path)}`)
          expect(response.status).toBe(200)
          expect(await response.json()).toEqual({ enabled: false })
          // Base env is reconciled to match the config-derived state.
          expect(process.env.AX_CODE_SUPER_LONG).toBe("false")
        },
      })
    })
  })

  test("config true is honored even when base env says false", async () => {
    await withCleanSuperLongEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      // Config explicitly enables super_long. Even though the base env
      // says false, the config is the authority for the UI, so GET
      // returns true. The base env is then reconciled to match.
      await writeFile(
        path.join(tmp.path, "ax-code.json"),
        JSON.stringify({ model: "alibaba-coding-plan/qwen3.7-max", super_long: true }),
      )
      process.env.AX_CODE_SUPER_LONG = "false"

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const response = await Server.Default().request(`/super-long?directory=${encodeURIComponent(tmp.path)}`)
          expect(response.status).toBe(200)
          expect(await response.json()).toEqual({ enabled: true })
          expect(process.env.AX_CODE_SUPER_LONG).toBe("true")
        },
      })
    })
  })

  test("does not default on when autonomous mode is disabled", async () => {
    await withCleanSuperLongEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      await writeFile(
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
      await writeFile(path.join(tmp.path, "ax-code.json"), JSON.stringify({}))

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

  test("PUT persists super_long to config and overrides model default", async () => {
    await withCleanSuperLongEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      const configPath = path.join(tmp.path, "ax-code.json")
      await writeFile(configPath, JSON.stringify({ model: "qwen3.7-max" }))

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
          // PUT now persists to config, so the file should be updated.
          const updated = JSON.parse(await readFile(configPath, "utf-8"))
          expect(updated.super_long).toBe(false)
        },
      })
    })
  })

  test("PUT accepts string boolean feature state from JSON clients", async () => {
    await withCleanSuperLongEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      const configPath = path.join(tmp.path, "ax-code.json")
      await writeFile(configPath, JSON.stringify({ model: "qwen3.7-max" }))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const putSuperLong = await Server.Default().request(`/super-long?directory=${encodeURIComponent(tmp.path)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: "false" }),
          })
          expect(putSuperLong.status).toBe(200)
          expect(await putSuperLong.json()).toEqual({ enabled: false })

          const putAutonomous = await Server.Default().request(
            `/autonomous?directory=${encodeURIComponent(tmp.path)}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ enabled: "true" }),
            },
          )
          expect(putAutonomous.status).toBe(200)
          expect(await putAutonomous.json()).toEqual({ enabled: true })

          const updated = JSON.parse(await readFile(configPath, "utf-8"))
          expect(updated.super_long).toBe(false)
          expect(updated.autonomous).toBe(true)
        },
      })
    })
  })

  test("rejects enabling Super-Long when autonomous mode is disabled", async () => {
    await withCleanSuperLongEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      await writeFile(path.join(tmp.path, "ax-code.json"), JSON.stringify({ model: "qwen3.7-max", autonomous: false }))

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
        await writeFile(
          path.join(tmp.path, "ax-code.json"),
          JSON.stringify({
            model: "anthropic/claude-opus-4-8",
            super_long: { enabled: true, duration_hours: 2 },
          }),
        )
        const startedAt = Date.now() - 60_000

        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const session = await Session.create({ title: "super-long-status-session" })
            try {
              await writeFile(
                storePath,
                JSON.stringify({ runs: { [session.id]: { startedAt, lastSeenAt: startedAt } } }),
              )
              const response = await Server.Default().request(
                `/super-long/status?directory=${encodeURIComponent(tmp.path)}&sessionID=${session.id}`,
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
            } finally {
              await Session.remove(session.id)
            }
          },
        })
      } finally {
        if (previousStore === undefined) delete process.env.AX_CODE_SUPER_LONG_RUNTIME_STORE
        else process.env.AX_CODE_SUPER_LONG_RUNTIME_STORE = previousStore
      }
    })
  })

  test("status rejects session timing from a different project", async () => {
    await withCleanSuperLongEnv(async () => {
      await using current = await tmpdir({ git: true })
      await using other = await tmpdir({ git: true })
      const storePath = path.join(current.path, "super-long-runtime.json")
      const previousStore = process.env.AX_CODE_SUPER_LONG_RUNTIME_STORE
      process.env.AX_CODE_SUPER_LONG_RUNTIME_STORE = storePath
      let otherSessionID: SessionID | undefined
      try {
        await writeFile(
          path.join(current.path, "ax-code.json"),
          JSON.stringify({
            model: "anthropic/claude-opus-4-8",
            super_long: { enabled: true, duration_hours: 2 },
          }),
        )
        await Instance.provide({
          directory: other.path,
          fn: async () => {
            const session = await Session.create({ title: "other-project-super-long-status-session" })
            otherSessionID = session.id
          },
        })
        const startedAt = Date.now() - 60_000
        await writeFile(
          storePath,
          JSON.stringify({ runs: { [otherSessionID!]: { startedAt, lastSeenAt: startedAt } } }),
        )

        await Instance.provide({
          directory: current.path,
          fn: async () => {
            const response = await Server.Default().request(
              `/super-long/status?directory=${encodeURIComponent(current.path)}&sessionID=${otherSessionID}`,
            )
            expect(response.status).toBe(409)
          },
        })
      } finally {
        if (otherSessionID) {
          const sessionID = otherSessionID
          await Instance.provide({
            directory: other.path,
            fn: async () => {
              await Session.remove(sessionID)
            },
          }).catch(() => undefined)
        }
        if (previousStore === undefined) delete process.env.AX_CODE_SUPER_LONG_RUNTIME_STORE
        else process.env.AX_CODE_SUPER_LONG_RUNTIME_STORE = previousStore
      }
    })
  })

  test("status reports null timing when the session has no durable run", async () => {
    await withCleanSuperLongEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      await writeFile(path.join(tmp.path, "ax-code.json"), JSON.stringify({ model: "anthropic/claude-opus-4-8" }))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const response = await Server.Default().request(
            `/super-long/status?directory=${encodeURIComponent(tmp.path)}`,
          )
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

  test("status rejects malformed sessionID query values", async () => {
    await withCleanSuperLongEnv(async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const response = await Server.Default().request(
            `/super-long/status?directory=${encodeURIComponent(tmp.path)}&sessionID=not-a-session`,
          )

          expect(response.status).toBe(400)
          expect(await response.json()).toMatchObject({
            name: "InvalidRequestError",
            status: 400,
          })
        },
      })
    })
  })

  test("disabling autonomous turns super-long off durably; re-enabling does not resurrect it", async () => {
    await withCleanSuperLongEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      await writeFile(path.join(tmp.path, "ax-code.json"), JSON.stringify({}))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const directoryQuery = `directory=${encodeURIComponent(tmp.path)}`
          // Enable super-long (persists super_long: true to config)
          const enabled = await Server.Default().request(`/super-long?${directoryQuery}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: true }),
          })
          expect(enabled.status).toBe(200)
          expect(await enabled.json()).toEqual({ enabled: true })

          // Disabling autonomous forces super-long off (both at the
          // gate level and via env reconciliation).
          const autonomousOff = await Server.Default().request(`/autonomous?${directoryQuery}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: false }),
          })
          expect(autonomousOff.status).toBe(200)
          expect(await autonomousOff.json()).toEqual({ enabled: false })
          expect(process.env[OVERRIDE]).toBe("false")

          // While autonomous is off, super-long GET reports false
          // (autonomous gate is off).
          const superLongWhileOff = await Server.Default().request(`/super-long?${directoryQuery}`)
          expect(superLongWhileOff.status).toBe(200)
          expect(await superLongWhileOff.json()).toEqual({ enabled: false })

          // Disabling autonomous also PERSISTS super_long off, so
          // re-enabling autonomous must NOT silently resurrect a
          // Super-Long run the user never re-selected. Long-run mode
          // requires an explicit new opt-in after any autonomous-off.
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

          // An explicit re-enable still works.
          const reEnable = await Server.Default().request(`/super-long?${directoryQuery}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: true }),
          })
          expect(reEnable.status).toBe(200)
          expect(await reEnable.json()).toEqual({ enabled: true })
        },
      })
    })
  })
})
