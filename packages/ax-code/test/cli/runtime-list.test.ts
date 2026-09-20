import { describe, expect, test } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { Global } from "../../src/global"
import { RuntimeRegistry } from "../../src/runtime/runtime-registry"

// Ports on loopback with nothing listening: probe() fails fast, so every
// fabricated record lists as "unavailable" without starting real servers.
function record(directory: string, port: number): RuntimeRegistry.Record {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    directory,
    pid: process.pid,
    host: "runtime-list-test-host",
    version: "7.19.3-test",
    startedAt: Date.now(),
    url: `http://127.0.0.1:${port}/`,
    token: "list-test-token-aaaaaaaaaaaaaaaaaaaaaaaaaa",
  }
}

async function resetRuntimeDir() {
  const root = path.join(Global.Path.state, "runtime")
  await fs.rm(root, { recursive: true, force: true })
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  return root
}

async function writeRecord(root: string, name: string, data: unknown) {
  const file = path.join(root, name)
  await fs.writeFile(file, JSON.stringify(data), { mode: 0o600 })
  await fs.chmod(file, 0o600)
}

describe("RuntimeRegistry.list", () => {
  test("returns an empty array when no runtime records exist", async () => {
    await resetRuntimeDir()
    expect(await RuntimeRegistry.list()).toEqual([])
  })

  test("returns valid records sorted by directory and skips corrupt or non-record files", async () => {
    const root = await resetRuntimeDir()
    const first = record("/tmp/ax-code-runtime-list-first", 47031)
    const second = record("/tmp/ax-code-runtime-list-second", 47032)
    // Written out of order; the hash-like file names must not affect ordering.
    await writeRecord(root, `${randomUUID()}.json`, second)
    await writeRecord(root, `${randomUUID()}.json`, first)
    // Parses as JSON but fails the record schema — must be skipped, not thrown.
    await writeRecord(root, "corrupt.json", { schemaVersion: 1 })
    await writeRecord(root, "noise.log", "not a record")

    const entries = await RuntimeRegistry.list()
    expect(entries.map((entry) => entry.directory)).toEqual([
      "/tmp/ax-code-runtime-list-first",
      "/tmp/ax-code-runtime-list-second",
    ])
    for (const entry of entries) expect(entry.state).toBe("unavailable")
    expect(entries[0]!.record.id).toBe(first.id)
    expect(entries[1]!.record.id).toBe(second.id)
  })
})
