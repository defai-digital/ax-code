import { afterEach, describe, expect, test, vi } from "vitest"
import { Hono } from "hono"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { AX_ENGINE_PROVIDER_ID, probeAxEngineConnection } from "../../src/provider/ax-engine"
import { appErrorEnvelope, appErrorResponse } from "../../src/server/error"
import { ProviderRoutes } from "../../src/server/routes/provider"
import { Log } from "../../src/util/log"

vi.mock("../../src/provider/ax-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/provider/ax-engine")>()
  return {
    ...actual,
    getAxEngineStatus: vi.fn(async () => ({
      server: { ready: false, blockers: [] },
      capability: { toolcall: false },
    })),
    getServerStatus: vi.fn(async () => ({ running: false, ready: false, blockers: [] })),
    probeAxEngineConnection: vi.fn(async ({ baseURL }: { baseURL: string }) => ({
      baseURL,
      models: [{ id: "attached-model" }],
      toolcall: true,
    })),
  }
})

Log.init({ print: false })

function fixture() {
  let config: Config.Info = {
    provider: {
      [AX_ENGINE_PROVIDER_ID]: {
        name: "AX Engine (Local)",
        options: { connectionMode: "attach", baseURL: "http://127.0.0.1:31418/v1", apiKey: "" },
      },
    },
  }
  const getConfig = vi.spyOn(Config, "get").mockImplementation(async () => config)
  const updateConfig = vi.spyOn(Config, "updateGlobal").mockImplementation(async (patch) => {
    config = { ...config, ...patch }
    return config
  })
  return {
    getConfig,
    updateConfig,
    request(body: object, directory = "/project-a") {
      // Global auth must be protected even across separate route mounts and directories.
      const app = new Hono().route("/provider", ProviderRoutes())
      app.onError((error, c) => appErrorResponse(c, appErrorEnvelope({ error })))
      return Promise.resolve(
        app.request(`/provider/ax-engine/connection?directory=${encodeURIComponent(directory)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      )
    },
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  await Auth.remove(AX_ENGINE_PROVIDER_ID)
})

describe.each([true, false])("AX Engine connection concurrency with previous auth: %s", (hasPreviousAuth) => {
  test.each(["managed", "attach"] as const)(
    "rejects another update while a failing %s update holds an auth snapshot",
    async (mode) => {
      const f = fixture()
      const previousAuth = hasPreviousAuth ? { type: "api" as const, key: "previous-key" } : undefined
      if (previousAuth) await Auth.set(AX_ENGINE_PROVIDER_ID, previousAuth)
      const writing = Promise.withResolvers<void>()
      const resume = Promise.withResolvers<void>()
      f.updateConfig.mockImplementationOnce(async () => {
        writing.resolve()
        await resume.promise
        throw new Error("Config write failed")
      })
      const attach = { mode: "attach", baseURL: "http://127.0.0.1:31419", apiKey: "replacement-key" }
      const first = f.request(mode === "managed" ? { mode } : { ...attach, apiKey: "pending-key" })
      let concurrent: Response
      try {
        await writing.promise
        concurrent = await f.request(mode === "managed" ? attach : { mode: "managed" }, "/project-b")
      } finally {
        resume.resolve()
        await first
      }

      expect((await first).status).toBe(400)
      expect(await Auth.get(AX_ENGINE_PROVIDER_ID)).toEqual(previousAuth)
      expect(concurrent.status).toBe(409)
      expect(await concurrent.json()).toMatchObject({
        name: "ServiceUnavailableError",
        status: 409,
        retryable: true,
        details: { resource: "axEngineConnection", providerID: AX_ENGINE_PROVIDER_ID },
      })
      expect(f.updateConfig).toHaveBeenCalledTimes(1)
      expect(probeAxEngineConnection).toHaveBeenCalledTimes(mode === "attach" ? 1 : 0)

      const retry = await f.request(attach, "/project-b")
      expect(retry.status).toBe(200)
      expect(await Auth.get(AX_ENGINE_PROVIDER_ID)).toEqual({ type: "api", key: "replacement-key" })
      expect((await f.getConfig()).provider?.[AX_ENGINE_PROVIDER_ID]?.options?.connectionMode).toBe("attach")
    },
  )
})

describe("AX Engine connection guard cleanup", () => {
  test.each(["config", "auth"] as const)(
    "guards the initial %s read and releases after a read failure",
    async (read) => {
      const f = fixture()
      const reading = Promise.withResolvers<void>()
      const resume = Promise.withResolvers<void>()
      const get = read === "config" ? f.getConfig : vi.spyOn(Auth, "get")
      get.mockImplementationOnce(async () => {
        reading.resolve()
        await resume.promise
        throw new Error("Snapshot read failed")
      })
      const first = f.request({ mode: "managed" })
      try {
        await reading.promise
        const concurrent = await f.request({ mode: "managed" }, "/project-b")
        expect(concurrent.status).toBe(409)
        expect(get).toHaveBeenCalledTimes(1)
        expect(f.updateConfig).not.toHaveBeenCalled()
      } finally {
        resume.resolve()
        await first
      }
      expect((await first).status).toBe(500)
      expect((await f.request({ mode: "managed" })).status).toBe(200)
    },
  )

  test.each([false, true])(
    "keeps the guard until auth rollback settles (rollback fails: %s)",
    async (rollbackFails) => {
      const f = fixture()
      const previousAuth = { type: "api" as const, key: "previous-key" }
      await Auth.set(AX_ENGINE_PROVIDER_ID, previousAuth)
      f.updateConfig.mockRejectedValueOnce(new Error("Config write failed"))
      const restoring = Promise.withResolvers<void>()
      const resume = Promise.withResolvers<void>()
      const setAuth = Auth.set
      vi.spyOn(Auth, "set").mockImplementationOnce(async (providerID, auth) => {
        restoring.resolve()
        await resume.promise
        if (rollbackFails) throw new Error("Auth restore failed")
        await setAuth(providerID, auth)
      })
      const first = f.request({ mode: "managed" })
      const attach = { mode: "attach", baseURL: "http://127.0.0.1:31419", apiKey: "replacement-key" }
      try {
        await restoring.promise
        const concurrent = await f.request(attach, "/project-b")
        expect(concurrent.status).toBe(409)
        expect(probeAxEngineConnection).not.toHaveBeenCalled()
      } finally {
        resume.resolve()
        await first
      }
      expect((await first).status).toBe(400)
      expect(await Auth.get(AX_ENGINE_PROVIDER_ID)).toEqual(rollbackFails ? undefined : previousAuth)
      expect((await f.request(attach)).status).toBe(200)
      expect(await Auth.get(AX_ENGINE_PROVIDER_ID)).toEqual({ type: "api", key: "replacement-key" })
      expect((await f.request({ mode: "managed" })).status).toBe(200)
      expect(await Auth.get(AX_ENGINE_PROVIDER_ID)).toBeUndefined()
    },
  )
})
