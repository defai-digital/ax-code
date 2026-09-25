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
    await client.waitForDiagnostics({ path: source })
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
