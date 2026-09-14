import { test, expect, vi } from "vitest"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { Instance, tmpdir } from "./harness"
import { LSPServerConfig } from "../src/server-config"
import { LSP } from "../src/index-impl"
import { codeIntelHost, configureCodeIntelHost } from "../src/host"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

test("disposal during an admitted spawn stops the late process before client registration", async () => {
  vi.stubEnv("AX_CODE_MEMORY_PROFILE", "low")
  await using tmp = await tmpdir()
  const started = deferred()
  const gate = deferred()
  const serverPath = fileURLToPath(new URL("./fixture/fake-lsp-server.js", import.meta.url))
  let child: ReturnType<typeof spawn> | undefined
  vi.spyOn(LSPServerConfig, "buildEnabledServers").mockReturnValue({
    fake: {
      id: "fake",
      extensions: [".ts"],
      semantic: true,
      root: async () => tmp.path,
      spawn: async () => {
        const process = spawn(globalThis.process.execPath, [serverPath], { stdio: "pipe" })
        child = process
        started.resolve()
        await gate.promise
        return { process }
      },
    },
  })
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
        const work = LSP.prewarmFiles([`${tmp.path}/source.ts`])
        await started.promise
        const shutdown = dispose!()
        // Disposal has to wait for an already-admitted server.spawn, but the
        // returned process must be stopped before it can become a live client.
        gate.resolve()
        const result = await work
        await shutdown
        expect(result.readyCount).toBe(0)
        expect(child).toBeDefined()
        expect(child!.exitCode !== null || child!.signalCode !== null).toBe(true)
      },
    })
  } finally {
    gate.resolve()
    child?.kill("SIGKILL")
    configureCodeIntelHost(host)
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  }
})
