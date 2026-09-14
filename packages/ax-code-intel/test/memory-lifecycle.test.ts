import { test, expect, vi } from "vitest"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { Instance, tmpdir } from "./harness"
import { LSPClient } from "../src/client"
import { LSPServerConfig } from "../src/server-config"
import { LSP } from "../src/index-impl"
import { codeIntelHost, configureCodeIntelHost } from "../src/host"
import { LOW_MEMORY_IDLE_MS } from "../src/prewarm-profile"

test("low profile reaps only idle clients and restarts on demand without a false clean inventory", async () => {
  vi.stubEnv("AX_CODE_MEMORY_PROFILE", "low")
  await using tmp = await tmpdir()
  const clients: LSPClient.Info[] = []
  const originalCreate = LSPClient.create
  vi.spyOn(LSPClient, "create").mockImplementation(async (input) => {
    const client = await originalCreate(input)
    clients.push(client)
    return client
  })
  const serverPath = fileURLToPath(new URL("./fixture/fake-lsp-server.js", import.meta.url))
  vi.spyOn(LSPServerConfig, "buildEnabledServers").mockReturnValue({
    fake: {
      id: "fake",
      extensions: [".ts"],
      semantic: true,
      root: async () => tmp.path,
      spawn: async () => ({ process: spawn(process.execPath, [serverPath], { stdio: "pipe" }) }),
    },
  })
  const intervals: Array<() => void> = []
  const originalInterval = globalThis.setInterval
  vi.spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void, ms: number) => {
    intervals.push(callback)
    return originalInterval(callback, ms)
  }) as typeof setInterval)
  const host = codeIntelHost()
  let dispose: (() => Promise<void>) | undefined
  configureCodeIntelHost({
    ...host,
    state: (init, cleanup) => {
      const getter = host.state(init, cleanup)
      dispose = getter.invalidate
      return getter
    },
  })
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await LSP.prewarmFiles([`${tmp.path}/source.ts`])
        expect(clients).toHaveLength(1)
        expect(await LSP.status()).toHaveLength(1)
        const release = clients[0].activity.retain()
        const now = performance.now()
        const clock = vi.spyOn(performance, "now").mockReturnValue(now + LOW_MEMORY_IDLE_MS * 2)
        for (const tick of intervals) tick()
        expect(await LSP.status()).toHaveLength(1)
        release()
        for (const tick of intervals) tick()
        expect(await LSP.status()).toHaveLength(1)
        clock.mockReturnValue(now + LOW_MEMORY_IDLE_MS * 4)
        for (const tick of intervals) tick()
        expect(await LSP.status()).toHaveLength(0)
        expect((await LSP.diagnosticsAggregated()).degraded).toBe(true)
        clock.mockRestore()
        await LSP.prewarmFiles([`${tmp.path}/source.ts`])
        expect(clients).toHaveLength(2)
        expect(await LSP.status()).toHaveLength(1)
        expect((await LSP.diagnosticsAggregated()).degraded).toBe(true)
        await dispose?.()
      },
    })
  } finally {
    await Promise.all(clients.map((client) => client.shutdown()))
    configureCodeIntelHost(host)
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  }
})
