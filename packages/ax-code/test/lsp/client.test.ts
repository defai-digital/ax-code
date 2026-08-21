import { afterEach, describe, expect, test, beforeEach, vi } from "vitest"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { LSPClient } from "@ax-code/ax-code-intel/client"
import { LSPServer } from "@ax-code/ax-code-intel/server"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { Filesystem } from "@ax-code/ax-code-intel/internal/filesystem"

// Minimal fake LSP server that speaks JSON-RPC over stdio
function spawnFakeServer(env?: Record<string, string>) {
  const { spawn } = require("child_process")
  const serverPath = path.join(__dirname, "../fixture/lsp/fake-lsp-server.js")
  const proc = spawn(process.execPath, [serverPath], {
    stdio: "pipe",
    env: {
      ...process.env,
      ...env,
    },
  })

  // Watch the server's stdout alongside the LSP client reader (multiple data
  // listeners are fine) so tests can await deterministic server notifications
  // — `test/ready` once the handshake settled, `test/roundtrip` once the
  // client answered a server-initiated request — instead of fixed sleeps.
  const buffered: { method: string; params?: unknown }[] = []
  const waiters: { method: string; resolve: (msg: any) => void }[] = []
  let readBuffer = Buffer.alloc(0)
  proc.stdout!.on("data", (chunk: Buffer) => {
    readBuffer = Buffer.concat([readBuffer, chunk])
    for (;;) {
      const headerEnd = readBuffer.indexOf("\r\n\r\n")
      if (headerEnd === -1) break
      const match = /Content-Length:\s*(\d+)/i.exec(readBuffer.subarray(0, headerEnd).toString("utf8"))
      const length = match ? parseInt(match[1], 10) : 0
      const bodyEnd = headerEnd + 4 + length
      if (readBuffer.length < bodyEnd) break
      let msg: any
      try {
        msg = JSON.parse(readBuffer.subarray(headerEnd + 4, bodyEnd).toString("utf8"))
      } catch {
        msg = undefined
      }
      readBuffer = readBuffer.subarray(bodyEnd)
      if (!msg || typeof msg.method !== "string" || typeof msg.id !== "undefined") continue
      const waiterIndex = waiters.findIndex((w) => w.method === msg.method)
      if (waiterIndex === -1) {
        buffered.push(msg)
      } else {
        const [waiter] = waiters.splice(waiterIndex, 1)
        waiter.resolve(msg)
      }
    }
  })

  function waitForNotification(method: string, timeoutMs = 10_000) {
    const bufferedIndex = buffered.findIndex((msg) => msg.method === method)
    if (bufferedIndex !== -1) {
      const [msg] = buffered.splice(bufferedIndex, 1)
      return Promise.resolve(msg)
    }
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = waiters.findIndex((w) => w.resolve === settle)
        if (index !== -1) waiters.splice(index, 1)
        reject(new Error(`timed out waiting for "${method}" notification from fake LSP server`))
      }, timeoutMs)
      const settle = (msg: any) => {
        clearTimeout(timer)
        resolve(msg)
      }
      waiters.push({ method, resolve: settle })
    })
  }

  return { process: proc, waitForNotification }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe("LSPClient interop", () => {
  beforeEach(async () => {
    await Log.init({ print: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
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

    await handle.waitForNotification("test/ready")

    await client.connection.sendNotification("test/trigger", {
      method: "workspace/workspaceFolders",
    })

    await handle.waitForNotification("test/roundtrip")

    expect(client.connection).toBeDefined()

    await client.shutdown()
  })

  test("notify.open does not mutate caller input", async () => {
    await using tmp = await tmpdir()
    const file = "file.ts"
    const input = { path: file }
    await fs.writeFile(path.join(tmp.path, file), "export const x = 1\n")
    const handle = spawnFakeServer() as any

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
        })

        await client.notify.open(input)
        expect(input.path).toBe(file)

        await client.shutdown()
      },
    })
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

    await handle.waitForNotification("test/ready")

    await client.connection.sendNotification("test/trigger", {
      method: "client/registerCapability",
    })

    await handle.waitForNotification("test/roundtrip")

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

    await handle.waitForNotification("test/ready")

    await client.connection.sendNotification("test/trigger", {
      method: "client/unregisterCapability",
    })

    await handle.waitForNotification("test/roundtrip")

    expect(client.connection).toBeDefined()

    await client.shutdown()
  })

  test("captures initialize capabilities for method-aware routing", async () => {
    const handle = spawnFakeServer({
      FAKE_LSP_CAPABILITIES_JSON: JSON.stringify({
        hoverProvider: true,
        referencesProvider: true,
        documentSymbolProvider: false,
      }),
    }) as any

    const client = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: process.cwd(),
        }),
    })

    expect(client.methodSupport("hover")).toBe("supported")
    expect(client.methodSupport("references")).toBe("supported")
    expect(client.methodSupport("documentSymbol")).toBe("unsupported")
    expect(client.methodSupport("workspaceSymbol")).toBe("unknown")

    await client.shutdown()
  })

  test("skips diagnostics wait for unchanged file content", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "file.ts")
    await fs.writeFile(file, "export const x = 1\n")
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
    await fs.writeFile(file, "export const x = 1\n")
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
    await fs.writeFile(file, "export const x = 1\n")
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

  test("notify.open propagates filesystem errors when checking tracked files", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "private.ts")
    await fs.writeFile(file, "export const x = 1\n")
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

    const error = Object.assign(new Error("file is unreadable"), { code: "EACCES" })
    vi.spyOn(Filesystem, "exists").mockRejectedValueOnce(error)

    await expect(client.notify.open({ path: file })).rejects.toBe(error)
    expect(sent.some((item) => item.method === "textDocument/didClose")).toBe(false)

    await client.shutdown()
  })

  test("notify.open normalizes relative paths for incremental reopen", async () => {
    await using tmp = await tmpdir()
    const relativePath = path.join("src", "index.ts")
    const absolutePath = path.join(tmp.path, relativePath)
    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await fs.writeFile(absolutePath, "export const x = 1\n")

    // Incremental (ranged) didChange is only sent when the server negotiated
    // TextDocumentSyncKind.Incremental.
    const handle = spawnFakeServer({
      FAKE_LSP_CAPABILITIES_JSON: JSON.stringify({ textDocumentSync: 2 }),
    }) as any
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
        })

        const sent: { method: string; params: any }[] = []
        const conn = client.connection as typeof client.connection & {
          sendNotification: (method: string, params: any) => Promise<void>
        }
        const originalSendNotification = conn.sendNotification.bind(conn)
        conn.sendNotification = ((method: string, params: any) => {
          sent.push({ method, params })
          return originalSendNotification(method, params)
        }) as typeof conn.sendNotification

        await client.notify.open({ path: relativePath })
        sent.length = 0

        await fs.writeFile(absolutePath, "export const x = 1\nexport const y = 2\n")
        const changed = await client.notify.open({ path: relativePath })
        expect(changed).toBe(true)

        const didChange = sent.find((entry) => entry.method === "textDocument/didChange")
        expect(didChange).toBeDefined()
        expect(didChange?.params?.contentChanges?.length).toBeGreaterThan(0)
        const incremental = didChange?.params?.contentChanges?.some((change: { range?: object }) => "range" in change)
        expect(incremental).toBe(true)

        await client.shutdown()
      },
    })
  })

  test("notify.open sends full-document didChange when the server is full-sync only", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "index.ts")
    await fs.writeFile(file, "export const x = 1\n")

    const handle = spawnFakeServer({
      FAKE_LSP_CAPABILITIES_JSON: JSON.stringify({ textDocumentSync: 1 }),
    }) as any
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
        })

        const sent: { method: string; params: any }[] = []
        const conn = client.connection as typeof client.connection & {
          sendNotification: (method: string, params: any) => Promise<void>
        }
        const originalSendNotification = conn.sendNotification.bind(conn)
        conn.sendNotification = ((method: string, params: any) => {
          sent.push({ method, params })
          return originalSendNotification(method, params)
        }) as typeof conn.sendNotification

        await client.notify.open({ path: file })
        sent.length = 0

        const updated = "export const x = 1\nexport const y = 2\n"
        await fs.writeFile(file, updated)
        const changed = await client.notify.open({ path: file })
        expect(changed).toBe(true)

        // A Full-sync server must never receive ranged changes: the whole
        // document is sent as a single range-less change instead.
        const didChange = sent.find((entry) => entry.method === "textDocument/didChange")
        expect(didChange).toBeDefined()
        expect(didChange?.params?.contentChanges).toEqual([{ text: updated }])

        await client.shutdown()
      },
    })
  })

  test("notify.open serializes concurrent updates for the same file", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "file.ts")
    await fs.writeFile(file, "export const x = 1\n")
    const handle = spawnFakeServer() as any

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
        })

        await client.notify.open({ path: file })

        const firstDidChange = deferred()
        const releaseDidChange = deferred()
        const didChangeVersions: number[] = []
        const conn = client.connection as typeof client.connection & {
          sendNotification: (method: string, params: any) => Promise<void>
        }
        const originalSendNotification = conn.sendNotification.bind(conn)
        conn.sendNotification = (async (method: string, params: any) => {
          if (method === "textDocument/didChange") {
            didChangeVersions.push(params?.textDocument?.version)
            if (didChangeVersions.length === 1) {
              firstDidChange.resolve()
              await releaseDidChange.promise
            }
          }
          return originalSendNotification(method, params)
        }) as typeof conn.sendNotification

        await fs.writeFile(file, "export const x = 1\nexport const y = 2\n")
        const first = client.notify.open({ path: file })
        const second = client.notify.open({ path: file })

        await firstDidChange.promise
        await new Promise((resolve) => setTimeout(resolve, 25))
        expect(didChangeVersions).toEqual([1])

        releaseDidChange.resolve()
        await expect(first).resolves.toBe(true)
        await expect(second).resolves.toBe(false)
        expect(didChangeVersions).toEqual([1])

        await client.shutdown()
      },
    })
  })

  test("notify.open resolves languageId for extensionless files", async () => {
    await using tmp = await tmpdir()
    const dockerfilePath = path.join(tmp.path, "Dockerfile")
    const makefilePath = path.join(tmp.path, "Makefile")
    await fs.writeFile(dockerfilePath, "FROM node:20-alpine\n")
    await fs.writeFile(makefilePath, "all:\n\t@echo hi\n")

    const handle = spawnFakeServer() as any
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
        })

        const sent: { method: string; params: any }[] = []
        const conn = client.connection as typeof client.connection & {
          sendNotification: (method: string, params: any) => Promise<void>
        }
        const originalSendNotification = conn.sendNotification.bind(conn)
        conn.sendNotification = ((method: string, params: any) => {
          sent.push({ method, params })
          return originalSendNotification(method, params)
        }) as typeof conn.sendNotification

        await client.notify.open({ path: "Dockerfile" })
        await client.notify.open({ path: "Makefile" })

        const openEntries = sent.filter((entry) => entry.method === "textDocument/didOpen")
        expect(openEntries.length).toBe(2)

        expect(openEntries[0]?.params?.textDocument?.languageId).toBe("dockerfile")
        expect(openEntries[1]?.params?.textDocument?.languageId).toBe("makefile")

        await client.shutdown()
      },
    })
  })

  test("notify.open allows a server-specific languageId override", async () => {
    await using tmp = await tmpdir()
    const playbookPath = path.join(tmp.path, "playbook.yml")
    await fs.writeFile(playbookPath, "- hosts: all\n  tasks: []\n")

    const handle = spawnFakeServer() as any
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = await LSPClient.create({
          serverID: "ansible-language-server",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
          languageId: "ansible",
        })

        const sent: { method: string; params: any }[] = []
        const conn = client.connection as typeof client.connection & {
          sendNotification: (method: string, params: any) => Promise<void>
        }
        const originalSendNotification = conn.sendNotification.bind(conn)
        conn.sendNotification = ((method: string, params: any) => {
          sent.push({ method, params })
          return originalSendNotification(method, params)
        }) as typeof conn.sendNotification

        await client.notify.open({ path: "playbook.yml" })

        const openEntry = sent.find((entry) => entry.method === "textDocument/didOpen")
        expect(openEntry?.params?.textDocument?.languageId).toBe("ansible")

        await client.shutdown()
      },
    })
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
