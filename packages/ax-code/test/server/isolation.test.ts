import { describe, expect, test } from "vitest"
import path from "path"
import { writeFile, readFile } from "node:fs/promises"
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
  test("defaults to full-access when config has no isolation setting", async () => {
    await withCleanIsolationEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      await writeFile(path.join(tmp.path, "ax-code.json"), JSON.stringify({}))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const response = await Server.Default().request(`/isolation?directory=${encodeURIComponent(tmp.path)}`)
          expect(response.status).toBe(200)
          expect(await response.json()).toEqual({ mode: "full-access", network: true })
        },
      })
    })
  })

  test("explicit env mode overrides config for GET", async () => {
    await withCleanIsolationEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      // CLI --sandbox is represented by this env flag and must remain the
      // highest-precedence source when the TUI synchronizes its state.
      await writeFile(path.join(tmp.path, "ax-code.json"), JSON.stringify({ isolation: { mode: "workspace-write" } }))
      process.env.AX_CODE_ISOLATION_MODE = "full-access"

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const response = await Server.Default().request(`/isolation?directory=${encodeURIComponent(tmp.path)}`)
          expect(response.status).toBe(200)
          expect(await response.json()).toEqual({ mode: "full-access", network: true })
          expect(process.env.AX_CODE_ISOLATION_MODE).toBe("full-access")
        },
      })
    })
  })

  test("explicit restricted env mode overrides config read-only", async () => {
    await withCleanIsolationEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      await writeFile(path.join(tmp.path, "ax-code.json"), JSON.stringify({ isolation: { mode: "read-only" } }))
      process.env.AX_CODE_ISOLATION_MODE = "workspace-write"

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const response = await Server.Default().request(`/isolation?directory=${encodeURIComponent(tmp.path)}`)
          expect(response.status).toBe(200)
          expect(await response.json()).toEqual({ mode: "workspace-write", network: false })
          expect(process.env.AX_CODE_ISOLATION_MODE).toBe("workspace-write")
        },
      })
    })
  })

  test("full-access implies network true", async () => {
    await withCleanIsolationEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      await writeFile(path.join(tmp.path, "ax-code.json"), JSON.stringify({ isolation: { mode: "full-access" } }))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const response = await Server.Default().request(`/isolation?directory=${encodeURIComponent(tmp.path)}`)
          expect(response.status).toBe(200)
          expect(await response.json()).toEqual({ mode: "full-access", network: true })
          expect(process.env.AX_CODE_ISOLATION_NETWORK).toBeUndefined()
        },
      })
    })
  })

  test("GET refreshes externally edited config without manufacturing env overrides", async () => {
    await withCleanIsolationEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      await writeFile(
        path.join(tmp.path, "ax-code.json"),
        JSON.stringify({ isolation: { mode: "workspace-write", network: false } }),
      )

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const response = await Server.Default().request(`/isolation?directory=${encodeURIComponent(tmp.path)}`)
          expect(response.status).toBe(200)
          expect(await response.json()).toEqual({ mode: "workspace-write", network: false })

          await writeFile(
            path.join(tmp.path, "ax-code.json"),
            JSON.stringify({ isolation: { mode: "read-only", network: false } }),
          )
          const refreshed = await Server.Default().request(`/isolation?directory=${encodeURIComponent(tmp.path)}`)
          expect(await refreshed.json()).toEqual({ mode: "read-only", network: false })
          expect(process.env.AX_CODE_ISOLATION_MODE).toBeUndefined()
          expect(process.env.AX_CODE_ISOLATION_NETWORK).toBeUndefined()
        },
      })
    })
  })

  test("PUT persists isolation to config and sets env vars", async () => {
    await withCleanIsolationEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      const configPath = path.join(tmp.path, "ax-code.json")
      await writeFile(configPath, JSON.stringify({}))

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
          const updated = JSON.parse(await readFile(configPath, "utf-8"))
          expect(updated.isolation).toEqual({ mode: "read-only", network: false })

          // Persisted config, rather than a process-global env mutation, is
          // the runtime source for this directory.
          expect(process.env.AX_CODE_ISOLATION_MODE).toBeUndefined()
          expect(process.env.AX_CODE_ISOLATION_NETWORK).toBeUndefined()

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
      await writeFile(configPath, JSON.stringify({}))

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
          expect(process.env.AX_CODE_ISOLATION_MODE).toBeUndefined()
          expect(process.env.AX_CODE_ISOLATION_NETWORK).toBeUndefined()
        },
      })
    })
  })

  test("PUT preserves backend and protected when updating mode/network", async () => {
    await withCleanIsolationEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      const configPath = path.join(tmp.path, "ax-code.json")
      await writeFile(
        configPath,
        JSON.stringify({
          isolation: {
            mode: "workspace-write",
            network: false,
            backend: "os",
            protected: ["secrets"],
          },
        }),
      )

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

          const updated = JSON.parse(await readFile(configPath, "utf-8"))
          expect(updated.isolation).toEqual({
            mode: "read-only",
            network: false,
            backend: "os",
            protected: ["secrets"],
          })
        },
      })
    })
  })

  test("PUT parses explicit network false string without enabling network", async () => {
    await withCleanIsolationEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      const configPath = path.join(tmp.path, "ax-code.json")
      await writeFile(configPath, JSON.stringify({}))

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
          const updated = JSON.parse(await readFile(configPath, "utf-8"))
          expect(updated.isolation).toEqual({ mode: "workspace-write", network: false })
          expect(process.env.AX_CODE_ISOLATION_NETWORK).toBeUndefined()
        },
      })
    })
  })

  test("GET honors JSONC comments in ax-code.json", async () => {
    await withCleanIsolationEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      await writeFile(
        path.join(tmp.path, "ax-code.json"),
        `{
  // Default executor
  "model": "alibaba-token-plan/qwen3.8-max",
  "isolation": {
    "mode": "full-access",
    "network": true
  }
}
`,
      )

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const response = await Server.Default().request(`/isolation?directory=${encodeURIComponent(tmp.path)}`)
          expect(response.status).toBe(200)
          expect(await response.json()).toEqual({ mode: "full-access", network: true })
          expect(process.env.AX_CODE_ISOLATION_MODE).toBeUndefined()
        },
      })
    })
  })

  test("PUT persists isolation into JSONC config without stripping comments", async () => {
    await withCleanIsolationEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      const configPath = path.join(tmp.path, "ax-code.json")
      await writeFile(
        configPath,
        `{
  // keep this comment
  "model": "alibaba-token-plan/qwen3.8-max",
  "isolation": {
    "mode": "workspace-write",
    "network": false
  }
}
`,
      )

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

          const updated = await readFile(configPath, "utf-8")
          expect(updated).toContain("// keep this comment")
          expect(updated).toContain('"model": "alibaba-token-plan/qwen3.8-max"')
          expect(updated).toContain('"mode": "full-access"')
          expect(updated).toContain('"network": true')
        },
      })
    })
  })

  test("PUT persists the request but reports an explicit env override as effective", async () => {
    await withCleanIsolationEnv(async () => {
      await using tmp = await tmpdir({ git: true })
      const configPath = path.join(tmp.path, "ax-code.json")
      await writeFile(configPath, JSON.stringify({}))
      // Simulate --sandbox full-access at startup. The PUT still persists the
      // requested project preference, but it cannot outrank the CLI override.
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
          expect(await put.json()).toEqual({ mode: "full-access", network: true })
          expect(process.env.AX_CODE_ISOLATION_MODE).toBe("full-access")
          const updated = JSON.parse(await readFile(configPath, "utf-8"))
          expect(updated.isolation).toEqual({ mode: "workspace-write", network: false })
        },
      })
    })
  })
})
