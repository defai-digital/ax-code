import { test, expect, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Instance, tmpdir } from "./harness"
import { LSPClient } from "../src/client"
import { LSPServerConfig } from "../src/server-config"
import { LSP } from "../src/index-impl"
import { codeIntelHost, configureCodeIntelHost } from "../src/host"
import { LOW_MEMORY_IDLE_MS, NORMAL_MEMORY_IDLE_MS } from "../src/prewarm-profile"

let dispose: (() => Promise<void>) | undefined

test.each([
  ["low", LOW_MEMORY_IDLE_MS, true],
  ["normal", NORMAL_MEMORY_IDLE_MS, true],
  ["normal", NORMAL_MEMORY_IDLE_MS, false],
  ["normal", NORMAL_MEMORY_IDLE_MS, "push"],
] as const)("%s profile reaps only idle clients and preserves incomplete coverage", async (profile, idleMs, opened) => {
  vi.stubEnv("AX_CODE_MEMORY_PROFILE", profile)
  vi.stubEnv("AX_CODE_LSP_IDLE_MS", "invalid")
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
        const source = path.join(tmp.path, "source.ts")
        await LSP.prewarmFiles([source])
        expect(clients).toHaveLength(1)
        expect(await LSP.status()).toHaveLength(1)
        // An empty warmed server can be reclaimed without losing coverage.
        await fs.writeFile(source, "export const value = 1\n")
        if (opened === true) await clients[0].notify.open({ path: source })
        if (opened === "push")
          await clients[0].connection.sendRequest("test/publishDiagnostics", {
            uri: pathToFileURL(source).href,
            diagnostics: [],
          })
        const release = clients[0].activity.retain()
        const now = performance.now()
        const clock = vi.spyOn(performance, "now").mockReturnValue(now + idleMs * 2)
        for (const tick of intervals) tick()
        expect(await LSP.status()).toHaveLength(1)
        release()
        for (const tick of intervals) tick()
        expect(await LSP.status()).toHaveLength(1)
        clock.mockReturnValue(now + idleMs * 4)
        vi.stubEnv("AX_CODE_LSP_IDLE_MS", "0")
        for (const tick of intervals) tick()
        expect(await LSP.status()).toHaveLength(1)
        vi.stubEnv("AX_CODE_LSP_IDLE_MS", "invalid")
        for (const tick of intervals) tick()
        expect(await LSP.status()).toHaveLength(0)
        if (opened) await expect(LSP.diagnostics()).rejects.toThrow("incomplete")
        else expect(await LSP.diagnostics()).toEqual({})
        expect((await LSP.diagnosticsAggregated()).degraded).toBe(Boolean(opened))
        clock.mockRestore()
        await LSP.prewarmFiles([source])
        expect(clients).toHaveLength(2)
        if (opened) await expect(LSP.diagnostics()).rejects.toThrow("incomplete")
        else expect(await LSP.diagnostics()).toEqual({})
        expect(await LSP.status()).toHaveLength(1)
        expect((await LSP.diagnosticsAggregated()).degraded).toBe(Boolean(opened))
        await clients[1].notify.open({ path: source })
        await clients[1].connection.sendRequest("test/publishDiagnostics", {
          uri: pathToFileURL(source).href,
          diagnostics: [],
        })
        expect(await LSP.diagnostics()).toEqual({ [source]: [] })
        expect((await LSP.diagnosticsAggregated()).degraded).toBe(false)
        await dispose?.()
      },
    })
  } finally {
    await dispose?.()
    await Promise.all(clients.map((client) => client.shutdown()))
    configureCodeIntelHost(host)
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  }
})
