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
  const updateConfig = vi.fn(async (patch: Config.Info) => {
    config = { ...config, ...patch }
    return config
  })
  vi.spyOn(Config, "updateGlobal").mockImplementation(updateConfig)
  const restoreConfig = vi.fn<() => Promise<boolean>>()
  vi.spyOn(Config, "updateGlobalWithRollback").mockImplementation(async (patch) => {
    const previous = config
    const written = await updateConfig(patch)
    restoreConfig.mockImplementation(async () => {
      if (config !== written) return false
      config = previous
      return true
    })
    return restoreConfig
  })
  return {
    getConfig,
    updateConfig,
    restoreConfig,
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
      const first = f.request(
        read === "config"
          ? { mode: "managed" }
          : { mode: "attach", baseURL: "http://127.0.0.1:31419", apiKey: "explicit-key" },
      )
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
    "keeps the guard until config rollback settles (rollback fails: %s)",
    async (rollbackFails) => {
      const f = fixture()
      const previousAuth = { type: "api" as const, key: "previous-key" }
      await Auth.set(AX_ENGINE_PROVIDER_ID, previousAuth)
      vi.spyOn(Auth, "prepareRemoval").mockResolvedValueOnce(async () => {
        throw new Error("Auth removal failed")
      })
      const restoring = Promise.withResolvers<void>()
      const resume = Promise.withResolvers<void>()
      f.restoreConfig.mockImplementationOnce(async () => {
        restoring.resolve()
        await resume.promise
        if (rollbackFails) throw new Error("Config restore failed")
        return true
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
      expect(await Auth.get(AX_ENGINE_PROVIDER_ID)).toEqual(previousAuth)
      expect((await f.request(attach)).status).toBe(200)
      expect(await Auth.get(AX_ENGINE_PROVIDER_ID)).toEqual({ type: "api", key: "replacement-key" })
      expect((await f.request({ mode: "managed" })).status).toBe(200)
      expect(await Auth.get(AX_ENGINE_PROVIDER_ID)).toBeUndefined()
    },
  )
})

test.each(["managed", "attach"] as const)("failed %s save preserves a credential saved by a peer", async (mode) => {
  const f = fixture()
  await Auth.set(AX_ENGINE_PROVIDER_ID, { type: "api", key: "previous-key" })
  f.updateConfig.mockImplementationOnce(async () => {
    await Auth.set(AX_ENGINE_PROVIDER_ID, { type: "api", key: "peer-key" })
    throw new Error("Config write failed")
  })
  const response = await f.request(
    mode === "managed" ? { mode } : { mode, baseURL: "http://127.0.0.1:31419", apiKey: "pending-key" },
  )
  expect(response.status).toBe(400)
  expect(await Auth.get(AX_ENGINE_PROVIDER_ID)).toEqual({ type: "api", key: "peer-key" })
})

test("managed save restores its config and reports a conflict when the credential changes", async () => {
  const f = fixture()
  await Auth.set(AX_ENGINE_PROVIDER_ID, { type: "api", key: "previous-key" })
  const update = Config.updateGlobalWithRollback
  vi.spyOn(Config, "updateGlobalWithRollback").mockImplementationOnce(async (patch) => {
    const restore = await update(patch)
    await Auth.set(AX_ENGINE_PROVIDER_ID, { type: "api", key: "peer-key" })
    return restore
  })

  const response = await f.request({ mode: "managed" })
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({ status: 409, retryable: true })
  expect(f.restoreConfig).toHaveBeenCalledOnce()
  expect((await f.getConfig()).provider?.[AX_ENGINE_PROVIDER_ID]?.options?.connectionMode).toBe("attach")
  expect(await Auth.get(AX_ENGINE_PROVIDER_ID)).toEqual({ type: "api", key: "peer-key" })
})

test.each([false, true])("managed save compensates for a failed credential write (peer config: %s)", async (peer) => {
  const update = Config.updateGlobal
  const withRollback = Config.updateGlobalWithRollback
  await update({ username: "before-managed-update", snapshot: true })
  const f = fixture()
  vi.spyOn(Config, "updateGlobalWithRollback").mockImplementation(withRollback)
  await Auth.set(AX_ENGINE_PROVIDER_ID, { type: "api", key: "previous-key" })
  vi.spyOn(Auth, "prepareRemoval").mockResolvedValueOnce(async () => {
    if (peer) await update({ username: "peer-edit" })
    throw new Error("Credential write failed")
  })
  const response = await f.request({ mode: "managed" })
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ message: "Credential write failed" })
  const config = await Config.getGlobal()
  expect(config.username).toBe(peer ? "peer-edit" : "before-managed-update")
  expect(config.snapshot).toBe(true)
  expect(config.provider?.[AX_ENGINE_PROVIDER_ID]?.options?.connectionMode).toBe(peer ? "managed" : undefined)
  expect(await Auth.get(AX_ENGINE_PROVIDER_ID)).toEqual({ type: "api", key: "previous-key" })
  if (peer) await Config.removeGlobalProvider(AX_ENGINE_PROVIDER_ID)
})

test.each([
  { previous: "previous-key", peer: "peer-key", requested: undefined },
  { previous: "previous-key", peer: "previous-key", requested: " " },
  { previous: undefined, peer: "peer-key", requested: undefined },
])("implicit attach rejects a credential change during the probe (%j)", async ({ previous, peer, requested }) => {
  const f = fixture()
  if (previous) await Auth.set(AX_ENGINE_PROVIDER_ID, { type: "api", key: previous })
  vi.mocked(probeAxEngineConnection).mockImplementationOnce(async ({ baseURL }) => {
    await Auth.set(AX_ENGINE_PROVIDER_ID, { type: "api", key: peer })
    return { baseURL, models: [], toolcall: true }
  })
  const response = await f.request({ mode: "attach", baseURL: "http://127.0.0.1:31419", apiKey: requested })
  expect(response.status).toBe(409)
  expect(f.updateConfig).not.toHaveBeenCalled()
  expect(await Auth.get(AX_ENGINE_PROVIDER_ID)).toEqual({ type: "api", key: peer })
})

test("implicit attach can keep an unchanged saved credential", async () => {
  const f = fixture()
  await Auth.set(AX_ENGINE_PROVIDER_ID, { type: "api", key: "saved-key" })
  const response = await f.request({ mode: "attach", baseURL: "http://127.0.0.1:31419" })
  expect(response.status).toBe(200)
  expect(probeAxEngineConnection).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "saved-key" }))
  expect(await Auth.get(AX_ENGINE_PROVIDER_ID)).toEqual({ type: "api", key: "saved-key" })
})
