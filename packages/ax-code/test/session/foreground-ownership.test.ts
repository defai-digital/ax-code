import { spawn } from "node:child_process"
import { once } from "node:events"
import fs from "node:fs"
import path from "node:path"
import { hostname } from "node:os"
import { randomUUID } from "node:crypto"
import { expect, test } from "vitest"
import { ForegroundOwnership } from "../../src/session/foreground-ownership"
import { tmpdir } from "../fixture/fixture"

test("same-process ownership is exclusive while independent sessions remain concurrent", async () => {
  await using tmp = await tmpdir()
  const db = path.join(tmp.path, "registry.db")
  const first = ForegroundOwnership.acquire(db, "one")
  const journal = first.begin()
  const file = ForegroundOwnership.paths(db, "one")
  try {
    expect(() => ForegroundOwnership.acquire(db, "one")).toThrow(ForegroundOwnership.BusyError)
    const second = ForegroundOwnership.acquire(db, "two")
    second.begin()
    second.release(true)
    expect(fs.readFileSync(file.journal, "utf8")).toBe(JSON.stringify(journal))
    if (process.platform !== "win32") {
      expect(fs.statSync(file.directory).mode & 0o777).toBe(0o700)
      expect(fs.statSync(file.guard).mode & 0o777).toBe(0o600)
      expect(fs.statSync(file.journal).mode & 0o777).toBe(0o600)
    }
  } finally {
    first.release(true)
    first.release(true)
  }
  expect(fs.existsSync(file.journal)).toBe(false)
  expect(fs.existsSync(file.guard)).toBe(true)
})

test("unfinished cleanup retains its generation, and release cannot delete a replacement", async () => {
  await using tmp = await tmpdir()
  const db = path.join(tmp.path, "registry.db")
  const first = ForegroundOwnership.acquire(db, "one")
  const previous = first.begin()
  first.release(false)
  const next = ForegroundOwnership.acquire(db, "one")
  expect(next.previous).toEqual(previous)
  const current = next.begin()
  const replacement = { ...current, generation: randomUUID() }
  const file = ForegroundOwnership.paths(db, "one")
  fs.writeFileSync(file.journal, JSON.stringify(replacement))
  expect(() => next.release(true)).toThrow(ForegroundOwnership.OwnershipError)
  next.release(true)
  expect(fs.readFileSync(file.journal, "utf8")).toBe(JSON.stringify(replacement))
  const third = ForegroundOwnership.acquire(db, "one")
  expect(third.previous).toEqual(replacement)
  third.release(false)
})

test.each([
  "partial-json",
  JSON.stringify({ version: 2, generation: randomUUID(), host: hostname(), sessionID: "one" }),
  JSON.stringify({ version: 1, generation: randomUUID(), host: hostname(), sessionID: "other" }),
  JSON.stringify({ version: 1, generation: randomUUID(), host: "foreign-host", sessionID: "one" }),
])("invalid or foreign journals block admission without changing their bytes (%s)", async (raw) => {
  await using tmp = await tmpdir()
  const db = path.join(tmp.path, "registry.db")
  const file = ForegroundOwnership.paths(db, "one")
  fs.mkdirSync(file.directory)
  fs.writeFileSync(file.journal, raw)
  expect(() => ForegroundOwnership.acquire(db, "one")).toThrow(ForegroundOwnership.OwnershipError)
  expect(() => ForegroundOwnership.acquire(db, "one")).toThrow(ForegroundOwnership.OwnershipError)
  expect(fs.readFileSync(file.journal, "utf8")).toBe(raw)
})

test("an oversized journal fails closed on its descriptor size without consuming its bytes", async () => {
  await using tmp = await tmpdir()
  const db = path.join(tmp.path, "registry.db")
  const file = ForegroundOwnership.paths(db, "one")
  const raw = JSON.stringify({
    version: 1,
    generation: randomUUID(),
    host: hostname(),
    sessionID: "one",
    padding: "x".repeat(16_384),
  })
  fs.mkdirSync(file.directory)
  fs.writeFileSync(file.journal, raw)
  expect(() => ForegroundOwnership.acquire(db, "one")).toThrow(ForegroundOwnership.OwnershipError)
  expect(fs.readFileSync(file.journal, "utf8")).toBe(raw)
})

test.skipIf(process.platform === "win32")(
  "a symlinked journal path fails closed instead of being followed",
  async () => {
    await using tmp = await tmpdir()
    const db = path.join(tmp.path, "registry.db")
    const file = ForegroundOwnership.paths(db, "one")
    const target = path.join(tmp.path, "outside.json")
    fs.mkdirSync(file.directory)
    fs.writeFileSync(
      target,
      JSON.stringify({ version: 1, generation: randomUUID(), host: hostname(), sessionID: "one" }),
    )
    fs.symlinkSync(target, file.journal)
    expect(() => ForegroundOwnership.acquire(db, "one")).toThrow(ForegroundOwnership.OwnershipError)
    expect(fs.readFileSync(target, "utf8")).toContain('"sessionID":"one"')
  },
)

test("external session identifiers cannot escape hashed ownership paths", async () => {
  await using tmp = await tmpdir()
  const db = path.join(tmp.path, "registry.db")
  const file = ForegroundOwnership.paths(db, "../../outside")
  expect(path.dirname(file.guard)).toBe(file.directory)
  expect(path.basename(file.guard)).toMatch(/^[a-f0-9]{64}\.db$/)
})

test.skipIf(process.platform === "win32")(
  "live and SIGSTOP owners block admission; SIGKILL releases ownership",
  async () => {
    await using tmp = await tmpdir()
    const db = path.join(tmp.path, "registry.db")
    const child = spawn(
      process.execPath,
      ["--import", "tsx", path.join(import.meta.dirname, "../fixture/foreground-owner.ts"), db, "one"],
      {
        cwd: path.join(import.meta.dirname, "../.."),
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
    let stderr = ""
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    const exited = once(child, "exit")
    try {
      await new Promise<void>((resolve, reject) => {
        let output = ""
        child.stdout.on("data", (chunk) => {
          output += chunk.toString()
          if (output.includes("owned\n")) resolve()
        })
        child.once("error", reject)
        child.once("exit", () => reject(new Error(stderr)))
      })
      const file = ForegroundOwnership.paths(db, "one")
      const original = fs.readFileSync(file.journal, "utf8")
      expect(() => ForegroundOwnership.acquire(db, "one")).toThrow(ForegroundOwnership.BusyError)
      child.kill("SIGSTOP")
      expect(() => ForegroundOwnership.acquire(db, "one")).toThrow(ForegroundOwnership.BusyError)
      expect(fs.readFileSync(file.journal, "utf8")).toBe(original)
      child.kill("SIGKILL")
      await exited
      const next = ForegroundOwnership.acquire(db, "one")
      expect(JSON.stringify(next.previous)).toBe(original)
      next.begin()
      next.release(true)
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL")
        await exited
      }
    }
  },
)
