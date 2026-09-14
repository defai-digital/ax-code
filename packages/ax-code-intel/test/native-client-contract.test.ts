import { expect, test } from "vitest"
import { once } from "node:events"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { tmpdir } from "./harness"
import { spawn } from "../src/launch"
import { LSPClient } from "../src/client"
import { aggregateEnvelope, collect } from "../src/diagnostics"
import { withTimeout } from "../src/internal/timeout"

test("launcher drains stderr without blocking the child", async () => {
  const child = spawn(process.execPath, [
    "-e",
    "process.stderr.write(Buffer.alloc(2 * 1024 * 1024), () => process.stdout.write('READY'))",
  ])
  let stdout = ""
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString()
  })
  const closed = once(child, "close")
  try {
    await withTimeout(closed, 3000)
    expect(stdout).toBe("READY")
    expect(child.exitCode).toBe(0)
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL")
      await closed
    }
  }
})

test("initialize sends owner PID and failed pull diagnostics remain degraded without failing document sync", async () => {
  await using tmp = await tmpdir()
  const source = path.join(tmp.path, "source.ts")
  await fs.writeFile(source, "export const answer = 42\n")
  const child = spawn(process.execPath, [fileURLToPath(new URL("./fixture/fake-lsp-server.js", import.meta.url))], {
    env: {
      ...process.env,
      FAKE_LSP_CAPABILITIES_JSON: JSON.stringify({
        diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: false },
      }),
    },
  })
  let client: Awaited<ReturnType<typeof LSPClient.create>> | undefined
  try {
    client = await LSPClient.create({ serverID: "typescript", root: tmp.path, server: { process: child } })
    const params = await client.connection.sendRequest<{ processId: number }>("test/initializeParams")
    expect(params.processId).toBe(process.pid)
    expect(params.processId).not.toBe(child.pid)
    await expect(client.notify.open({ path: source, waitForDiagnostics: true })).resolves.toBe(true)
    expect(client.diagnostics.has(source)).toBe(false)
    await expect(collect([client])).rejects.toThrow("incomplete")
    expect(await aggregateEnvelope([client])).toMatchObject({ degraded: true, completeness: "partial" })
  } finally {
    if (client) await client.shutdown()
    else child.kill("SIGKILL")
  }
})

test("native diagnostic pulls are lazy, expose pending state, and recover after failures", async () => {
  await using tmp = await tmpdir()
  const source = path.join(tmp.path, "source.ts")
  await fs.writeFile(source, "export const answer = 42\n")
  const child = spawn(process.execPath, [fileURLToPath(new URL("./fixture/fake-lsp-server.js", import.meta.url))], {
    env: {
      ...process.env,
      FAKE_LSP_CAPABILITIES_JSON: JSON.stringify({
        diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: false },
      }),
    },
  })
  const client = await LSPClient.create({ serverID: "typescript", root: tmp.path, server: { process: child } })
  try {
    await client.notify.open({ path: source })
    const state = await client.connection.sendRequest<{ requests: number }>("test/diagnostics", { report: null })
    expect(state.requests).toBe(0)
    expect(await aggregateEnvelope([client])).toMatchObject({ degraded: true, completeness: "partial" })
    await expect(client.waitForDiagnostics({ path: source })).rejects.toThrow("incomplete")
    expect(client.diagnosticsDegraded).toBe(true)
    await client.connection.sendRequest("test/diagnostics", { report: { kind: "full", items: [] }, hold: true })
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const listener = client.connection.onNotification("test/pullStarted", () => started())
    const pull = client.waitForDiagnostics({ path: source })
    await withTimeout(ready, 3000)
    expect(await aggregateEnvelope([client])).toMatchObject({ degraded: true, completeness: "partial" })
    await client.connection.sendRequest("test/diagnostics", { report: { kind: "full", items: [] } })
    await pull
    listener.dispose()
    await expect.poll(() => client.diagnosticsDegraded, { timeout: 3000 }).toBe(false)
    expect(client.diagnostics.get(source)).toEqual([])
    const refreshed = new Promise<void>((resolve) => {
      const listener = client.connection.onNotification("test/roundtrip", () => {
        listener.dispose()
        resolve()
      })
    })
    await client.connection.sendNotification("test/trigger", { method: "workspace/diagnostic/refresh" })
    await withTimeout(refreshed, 3000)
    expect(client.diagnosticsDegraded).toBe(true)
    expect(client.diagnostics.has(source)).toBe(false)
    await expect.poll(() => client.diagnosticsDegraded, { timeout: 3000 }).toBe(false)
    expect(client.diagnostics.get(source)).toEqual([])
    const diagnostic = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      message: "Type mismatch",
      severity: 1,
      code: 2322,
    }
    await client.connection.sendRequest("test/diagnostics", { report: { kind: "full", items: [diagnostic] } })
    await client.waitForDiagnostics({ path: source })
    await client.connection.sendRequest("test/publishDiagnostics", { uri: pathToFileURL(source).href, diagnostics: [] })
    expect(client.diagnostics.get(source)).toEqual([diagnostic])
  } finally {
    await client.shutdown()
  }
})

test("other language servers retain push diagnostics negotiation", async () => {
  await using tmp = await tmpdir()
  const child = spawn(process.execPath, [fileURLToPath(new URL("./fixture/fake-lsp-server.js", import.meta.url))], {
    env: { ...process.env, FAKE_LSP_CAPABILITIES_JSON: JSON.stringify({ diagnosticProvider: true }) },
  })
  const client = await LSPClient.create({ serverID: "rust", root: tmp.path, server: { process: child } })
  try {
    const params = await client.connection.sendRequest<{ capabilities: { textDocument: { diagnostic?: unknown } } }>(
      "test/initializeParams",
    )
    expect(params.capabilities.textDocument.diagnostic).toBeUndefined()
  } finally {
    await client.shutdown()
  }
})

test("native diagnostics use the same canonical path for open, wait, and close", async () => {
  const { vi } = await import("vitest")
  const { Filesystem } = await import("../src/internal/filesystem")
  await using tmp = await tmpdir()
  const source = path.join(tmp.path, "source.ts")
  await fs.mkdir(path.join(tmp.path, "nested"))
  await fs.writeFile(source, "export const answer = 42\n")
  const alias = `${tmp.path}${path.sep}nested${path.sep}..${path.sep}source.ts`
  // Model the canonicalization performed by Windows realpathSync.native.
  const canonical = vi.spyOn(Filesystem, "normalizePath").mockImplementation((value) => path.normalize(value))
  const child = spawn(process.execPath, [fileURLToPath(new URL("./fixture/fake-lsp-server.js", import.meta.url))], {
    env: { ...process.env, FAKE_LSP_CAPABILITIES_JSON: JSON.stringify({ diagnosticProvider: true }) },
  })
  const client = await LSPClient.create({ serverID: "typescript", root: tmp.path, server: { process: child } })
  try {
    const diagnostic = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      message: "Type mismatch",
      severity: 1,
      code: 2322,
    }
    await client.connection.sendRequest("test/diagnostics", { report: { kind: "full", items: [diagnostic] } })
    await client.notify.open({ path: alias })
    await client.waitForDiagnostics({ path: alias })
    expect(client.diagnostics.get(source)).toEqual([diagnostic])
    expect((await aggregateEnvelope([client], alias)).data).toHaveLength(1)
    expect(client.diagnosticsStale(alias)).toBe(false)
    await client.notify.close({ path: source })
    expect(client.diagnostics.size).toBe(0)
  } finally {
    canonical.mockRestore()
    await client.shutdown()
  }
})

test("native collection limits each pull to its remaining time budget", async () => {
  const { vi } = await import("vitest")
  await using tmp = await tmpdir()
  const source = path.join(tmp.path, "source.ts")
  await fs.writeFile(source, "export const answer = 42\n")
  const child = spawn(process.execPath, [fileURLToPath(new URL("./fixture/fake-lsp-server.js", import.meta.url))], {
    env: { ...process.env, FAKE_LSP_CAPABILITIES_JSON: JSON.stringify({ diagnosticProvider: true }) },
  })
  const client = await LSPClient.create({ serverID: "typescript", root: tmp.path, server: { process: child } })
  let inventory: Promise<void> | undefined
  let clock: ReturnType<typeof vi.spyOn> | undefined
  try {
    await client.notify.open({ path: source })
    await client.connection.sendRequest("test/diagnostics", { report: { kind: "full", items: [] }, hold: true })
    // Only 100 ms remain when the collection starts its first request.
    clock = vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(14_900)
    inventory = client.refreshDiagnosticInventory()
    await expect(withTimeout(inventory, 1000)).rejects.toThrow("incomplete")
  } finally {
    clock?.mockRestore()
    await client.connection.sendRequest("test/diagnostics", { report: { kind: "full", items: [] } })
    await inventory?.catch(() => {})
    await client.shutdown()
  }
})

test.each(["wait", "open"])(
  "overlapping native %s calls share one pull while sequential calls refresh",
  async (mode) => {
    await using tmp = await tmpdir()
    const source = path.join(tmp.path, "source.ts")
    await fs.writeFile(source, "export const value = 42\n")
    const child = spawn(process.execPath, [fileURLToPath(new URL("./fixture/fake-lsp-server.js", import.meta.url))], {
      env: { ...process.env, FAKE_LSP_CAPABILITIES_JSON: JSON.stringify({ diagnosticProvider: true }) },
    })
    const client = await LSPClient.create({ serverID: "typescript", root: tmp.path, server: { process: child } })
    try {
      await client.notify.open({ path: source })
      await client.connection.sendRequest("test/diagnostics", { report: { kind: "full", items: [] }, hold: true })
      let start!: () => void
      const started = new Promise<void>((resolve) => {
        start = resolve
      })
      const listener = client.connection.onNotification("test/pullStarted", start)
      const call = () =>
        mode === "wait"
          ? client.waitForDiagnostics({ path: source })
          : client.notify.open({ path: source, waitForDiagnostics: true })
      const waits = Promise.all(Array.from({ length: 20 }, call))
      await withTimeout(started, 3000)
      const state = await client.connection.sendRequest<{ requests: number }>("test/diagnostics", {
        report: { kind: "full", items: [] },
      })
      await waits
      listener.dispose()
      expect(state.requests).toBe(1)
      expect(client.diagnostics.get(source)).toEqual([])
      await call()
      const next = await client.connection.sendRequest<{ requests: number }>("test/diagnostics", {
        report: { kind: "full", items: [] },
      })
      expect(next.requests).toBe(2)
    } finally {
      await client.shutdown()
    }
  },
)

test("workspace changes prevent sharing an older in-flight native pull", async () => {
  await using tmp = await tmpdir()
  const source = path.join(tmp.path, "source.ts")
  const other = path.join(tmp.path, "other.ts")
  await fs.writeFile(source, "export const value = 42\n")
  await fs.writeFile(other, "export const other = 1\n")
  const child = spawn(process.execPath, [fileURLToPath(new URL("./fixture/fake-lsp-server.js", import.meta.url))], {
    env: { ...process.env, FAKE_LSP_CAPABILITIES_JSON: JSON.stringify({ diagnosticProvider: true }) },
  })
  const client = await LSPClient.create({ serverID: "typescript", root: tmp.path, server: { process: child } })
  try {
    await client.notify.open({ path: source })
    await client.connection.sendRequest("test/diagnostics", { report: { kind: "full", items: [] }, hold: true })
    let start!: () => void
    const started = new Promise<void>((resolve) => {
      start = resolve
    })
    const listener = client.connection.onNotification("test/pullStarted", start)
    const old = expect(client.waitForDiagnostics({ path: source })).rejects.toThrow("incomplete")
    await withTimeout(started, 3000)
    listener.dispose()
    await client.notify.open({ path: other })
    const current = client.waitForDiagnostics({ path: source })
    await client.connection.sendRequest("test/diagnostics", { report: { kind: "full", items: [] } })
    await Promise.all([old, current])
    const state = await client.connection.sendRequest<{ requests: number }>("test/diagnostics", {
      report: { kind: "full", items: [] },
    })
    expect(state.requests).toBe(2)
    expect(client.diagnosticsStale(source)).toBe(false)
    expect(client.diagnosticsStale(other)).toBe(true)
  } finally {
    await client.shutdown()
  }
})

test("expired close lock waits cannot later close a live document", async () => {
  await using tmp = await tmpdir()
  const source = path.join(tmp.path, "source.ts")
  await fs.writeFile(source, "export const value = 42\n")
  const child = spawn(process.execPath, [fileURLToPath(new URL("./fixture/fake-lsp-server.js", import.meta.url))], {
    env: { ...process.env, FAKE_LSP_CAPABILITIES_JSON: JSON.stringify({ diagnosticProvider: true }) },
  })
  const client = await LSPClient.create({ serverID: "typescript", root: tmp.path, server: { process: child } })
  try {
    await client.notify.open({ path: source })
    await client.connection.sendRequest("test/diagnostics", { report: { kind: "full", items: [] }, hold: true })
    let start!: () => void
    const started = new Promise<void>((resolve) => {
      start = resolve
    })
    const listener = client.connection.onNotification("test/pullStarted", start)
    const waiting = client.waitForDiagnostics({ path: source })
    await withTimeout(started, 3000)
    listener.dispose()
    await expect(client.notify.close({ path: source, deadline: Date.now() + 25 })).rejects.toThrow()
    await client.connection.sendRequest("test/diagnostics", { report: { kind: "full", items: [] } })
    await waiting
    expect(client.openPaths).toContain(source)
    expect(client.diagnostics.get(source)).toEqual([])
  } finally {
    await client.shutdown()
  }
})

test("timed-out close delivery frees local state but never reports a complete inventory", async () => {
  const { vi } = await import("vitest")
  await using tmp = await tmpdir()
  const source = path.join(tmp.path, "source.ts")
  await fs.writeFile(source, "export const value = 42\n")
  const child = spawn(process.execPath, [fileURLToPath(new URL("./fixture/fake-lsp-server.js", import.meta.url))], {
    env: { ...process.env, FAKE_LSP_CAPABILITIES_JSON: JSON.stringify({ diagnosticProvider: true }) },
  })
  const client = await LSPClient.create({ serverID: "typescript", root: tmp.path, server: { process: child } })
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  let send: ReturnType<typeof vi.spyOn> | undefined
  try {
    await client.notify.open({ path: source })
    send = vi.spyOn(client.connection, "sendNotification").mockReturnValue(pending)
    await client.notify.close({ path: source, deleted: true, deadline: Date.now() + 25 })
    expect(client.openPaths).not.toContain(source)
    expect(client.diagnosticsDegraded).toBe(true)
    await expect(collect([client])).rejects.toThrow("incomplete")
    expect((await aggregateEnvelope([client])).degraded).toBe(true)
  } finally {
    release()
    send?.mockRestore()
    await client.shutdown()
  }
})
