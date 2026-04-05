import { describe, expect, test, beforeEach } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { LSPClient } from "../../src/lsp/client"
import { LSPServer } from "../../src/lsp/server"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"

// Minimal fake LSP server that speaks JSON-RPC over stdio
function spawnFakeServer() {
  const { spawn } = require("child_process")
  const serverPath = path.join(__dirname, "../fixture/lsp/fake-lsp-server.js")
  return {
    process: spawn(process.execPath, [serverPath], {
      stdio: "pipe",
    }),
  }
}

describe("LSPClient interop", () => {
  beforeEach(async () => {
    await Log.init({ print: true })
  })

  test("handles workspace/workspaceFolders request", async () => {
    const handle = spawnFakeServer() as any

    const client = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: process.cwd(),
        }),
    })

    await client.connection.sendNotification("test/trigger", {
      method: "workspace/workspaceFolders",
    })

    await new Promise((r) => setTimeout(r, 100))

    expect(client.connection).toBeDefined()

    await client.shutdown()
  })

  test("handles client/registerCapability request", async () => {
    const handle = spawnFakeServer() as any

    const client = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: process.cwd(),
        }),
    })

    await client.connection.sendNotification("test/trigger", {
      method: "client/registerCapability",
    })

    await new Promise((r) => setTimeout(r, 100))

    expect(client.connection).toBeDefined()

    await client.shutdown()
  })

  test("handles client/unregisterCapability request", async () => {
    const handle = spawnFakeServer() as any

    const client = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: process.cwd(),
        }),
    })

    await client.connection.sendNotification("test/trigger", {
      method: "client/unregisterCapability",
    })

    await new Promise((r) => setTimeout(r, 100))

    expect(client.connection).toBeDefined()

    await client.shutdown()
  })

  test("skips diagnostics wait for unchanged file content", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "file.ts")
    await Bun.write(file, "export const x = 1\n")
    const handle = spawnFakeServer() as any

    const client = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
        }),
    })

    await client.notify.open({ path: file })

    const start = Date.now()
    const changed = await client.notify.open({ path: file, waitForDiagnostics: true })
    const elapsed = Date.now() - start

    expect(changed).toBe(false)
    expect(elapsed).toBeLessThan(500)

    await client.shutdown()
  })

  test("notify.close clears per-file state", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "file.ts")
    await Bun.write(file, "export const x = 1\n")
    const handle = spawnFakeServer() as any

    const client = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
        }),
    })

    // Open, then close, then open again — a fresh open after close should
    // behave like a first open (didOpen, not didChange skipped by hash).
    const firstOpen = await client.notify.open({ path: file })
    expect(firstOpen).toBe(true)

    const closed = await client.notify.close({ path: file })
    expect(closed).toBe(true)

    // Closing the same file twice is a no-op — it was never-opened after
    // the first close cleared state.
    const closedAgain = await client.notify.close({ path: file })
    expect(closedAgain).toBe(false)

    // Re-open goes through the "first open" path (state was cleared),
    // which also succeeds.
    const reopened = await client.notify.open({ path: file })
    expect(reopened).toBe(true)

    await client.shutdown()
  })

  test("notify.open short-circuits to close when file no longer exists", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "transient.ts")
    await Bun.write(file, "export const x = 1\n")
    const handle = spawnFakeServer() as any

    const client = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
        }),
    })

    // Open the file, then delete it, then touch it again. The second open
    // should return false (nothing sent) and clean up local state.
    const sent: { method: string; params: any }[] = []
    const conn = client.connection as typeof client.connection & {
      sendNotification: (method: string, params: any) => Promise<void>
    }
    const orig = conn.sendNotification.bind(conn)
    conn.sendNotification = ((method: string, params: any) => {
      sent.push({ method, params })
      return orig(method, params)
    }) as typeof conn.sendNotification

    await client.notify.open({ path: file })
    sent.length = 0
    await fs.unlink(file)

    const afterDelete = await client.notify.open({ path: file })
    expect(afterDelete).toBe(false)
    expect(sent.some((item) => item.method === "textDocument/didClose")).toBe(true)
    expect(
      sent.some(
        (item) =>
          item.method === "workspace/didChangeWatchedFiles" &&
          item.params?.changes?.some((change: { type: number }) => change.type === 3),
      ),
    ).toBe(true)

    await client.shutdown()
  })

  test("ping returns true for live process, false after process dies", async () => {
    await using tmp = await tmpdir()
    const handle = spawnFakeServer() as any

    const client = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
        }),
    })

    // Alive immediately after spawn.
    expect(client.ping()).toBe(true)

    // Kill the process and wait a beat for the kernel to reap it.
    handle.process.kill("SIGKILL")
    await new Promise((r) => setTimeout(r, 100))

    // ping() should now report dead.
    expect(client.ping()).toBe(false)

    // Cleanup (shutdown is safe to call on a dead process).
    await client.shutdown().catch(() => {})
  })
})
