import { describe, expect, test } from "vitest"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

async function withCleanIsolationEnv(fn: () => Promise<void>) {
  const previous = {
    mode: process.env.AX_CODE_ISOLATION_MODE,
    network: process.env.AX_CODE_ISOLATION_NETWORK,
  }
  delete process.env.AX_CODE_ISOLATION_MODE
  delete process.env.AX_CODE_ISOLATION_NETWORK
  try {
    await fn()
  } finally {
    if (previous.mode === undefined) delete process.env.AX_CODE_ISOLATION_MODE
    else process.env.AX_CODE_ISOLATION_MODE = previous.mode
    if (previous.network === undefined) delete process.env.AX_CODE_ISOLATION_NETWORK
    else process.env.AX_CODE_ISOLATION_NETWORK = previous.network
  }
}

describe("isolation route", () => {
  test("defaults to workspace-write when config has no isolation setting", async () => {
    await withCleanIsolationEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      await Bun.write(path.join(tmp.path, "ax-code.json"), JSON.stringify({}))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const response = await Server.Default().request(`/isolation?directory=${encodeURIComponent(tmp.path)}`)
          expect(response.status).toBe(200)
          expect(await response.json()).toEqual({ mode: "workspace-write", network: false })
        },
      })
    })
  })

  test("config is the authority — env var does not override config for GET", async () => {
    await withCleanIsolationEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      // Config says workspace-write. Even though the env says full-access,
      // the GET endpoint reconciles from config, so the UI sees workspace-write.
      await Bun.write(path.join(tmp.path, "ax-code.json"), JSON.stringify({ isolation: { mode: "workspace-write" } }))
      process.env.AX_CODE_ISOLATION_MODE = "full-access"

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const response = await Server.Default().request(`/isolation?directory=${encodeURIComponent(tmp.path)}`)
          expect(response.status).toBe(200)
          expect(await response.json()).toEqual({ mode: "workspace-write", network: false })
          // Env is reconciled to match the config-derived state.
          expect(process.env.AX_CODE_ISOLATION_MODE).toBe("workspace-write")
        },
      })
    })
  })

  test("config read-only is honored even when env says workspace-write", async () => {
    await withCleanIsolationEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      await Bun.write(path.join(tmp.path, "ax-code.json"), JSON.stringify({ isolation: { mode: "read-only" } }))
      process.env.AX_CODE_ISOLATION_MODE = "workspace-write"

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const response = await Server.Default().request(`/isolation?directory=${encodeURIComponent(tmp.path)}`)
          expect(response.status).toBe(200)
          expect(await response.json()).toEqual({ mode: "read-only", network: false })
          expect(process.env.AX_CODE_ISOLATION_MODE).toBe("read-only")
        },
      })
    })
  })

  test("full-access implies network true", async () => {
    await withCleanIsolationEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      await Bun.write(path.join(tmp.path, "ax-code.json"), JSON.stringify({ isolation: { mode: "full-access" } }))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const response = await Server.Default().request(`/isolation?directory=${encodeURIComponent(tmp.path)}`)
          expect(response.status).toBe(200)
          expect(await response.json()).toEqual({ mode: "full-access", network: true })
          expect(process.env.AX_CODE_ISOLATION_NETWORK).toBe("true")
        },
      })
    })
  })

  test("GET reconciles env vars to match config", async () => {
    await withCleanIsolationEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      await Bun.write(
        path.join(tmp.path, "ax-code.json"),
        JSON.stringify({ isolation: { mode: "workspace-write", network: true } }),
      )

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const response = await Server.Default().request(`/isolation?directory=${encodeURIComponent(tmp.path)}`)
          expect(response.status).toBe(200)
          expect(await response.json()).toEqual({ mode: "workspace-write", network: true })
          expect(process.env.AX_CODE_ISOLATION_MODE).toBe("workspace-write")
          expect(process.env.AX_CODE_ISOLATION_NETWORK).toBe("true")
        },
      })
    })
  })

  test("PUT persists isolation to config and sets env vars", async () => {
    await withCleanIsolationEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      const configPath = path.join(tmp.path, "ax-code.json")
      await Bun.write(configPath, JSON.stringify({}))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const put = await Server.Default().request(`/isolation?directory=${encodeURIComponent(tmp.path)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "read-only" }),
          })
          expect(put.status).toBe(200)
          expect(await put.json()).toEqual({ mode: "read-only", network: false })

          // Config file is updated
          const updated = JSON.parse(await Bun.file(configPath).text())
          expect(updated.isolation).toEqual({ mode: "read-only", network: false })

          // Env vars are set
          expect(process.env.AX_CODE_ISOLATION_MODE).toBe("read-only")
          expect(process.env.AX_CODE_ISOLATION_NETWORK).toBe("false")

          // Subsequent GET returns the persisted state
          const get = await Server.Default().request(`/isolation?directory=${encodeURIComponent(tmp.path)}`)
          expect(await get.json()).toEqual({ mode: "read-only", network: false })
        },
      })
    })
  })

  test("PUT full-access sets network true", async () => {
    await withCleanIsolationEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      const configPath = path.join(tmp.path, "ax-code.json")
      await Bun.write(configPath, JSON.stringify({}))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const put = await Server.Default().request(`/isolation?directory=${encodeURIComponent(tmp.path)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "full-access" }),
          })
          expect(put.status).toBe(200)
          expect(await put.json()).toEqual({ mode: "full-access", network: true })
          expect(process.env.AX_CODE_ISOLATION_MODE).toBe("full-access")
          expect(process.env.AX_CODE_ISOLATION_NETWORK).toBe("true")
        },
      })
    })
  })

  test("PUT parses explicit network false string without enabling network", async () => {
    await withCleanIsolationEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      const configPath = path.join(tmp.path, "ax-code.json")
      await Bun.write(configPath, JSON.stringify({}))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const put = await Server.Default().request(`/isolation?directory=${encodeURIComponent(tmp.path)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "workspace-write", network: "false" }),
          })

          expect(put.status).toBe(200)
          expect(await put.json()).toEqual({ mode: "workspace-write", network: false })
          const updated = JSON.parse(await Bun.file(configPath).text())
          expect(updated.isolation).toEqual({ mode: "workspace-write", network: false })
          expect(process.env.AX_CODE_ISOLATION_NETWORK).toBe("false")
        },
      })
    })
  })

  test("PUT response reports requested mode even when env var has a stale value", async () => {
    await withCleanIsolationEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      const configPath = path.join(tmp.path, "ax-code.json")
      await Bun.write(configPath, JSON.stringify({}))
      // Simulate a stale env var from --sandbox full-access at startup.
      // The PUT requests workspace-write; the response must report
      // workspace-write (the requested value), not full-access (stale).
      process.env.AX_CODE_ISOLATION_MODE = "full-access"

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const put = await Server.Default().request(`/isolation?directory=${encodeURIComponent(tmp.path)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "workspace-write" }),
          })
          expect(put.status).toBe(200)
          // The response must report the requested mode, not the stale env.
          expect(await put.json()).toEqual({ mode: "workspace-write", network: false })
          expect(process.env.AX_CODE_ISOLATION_MODE).toBe("workspace-write")
        },
      })
    })
  })
})
