import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { tmpdir } from "../fixture/fixture"
import { MigrationLock } from "../../src/storage/migrate-lock"

function waitForLine(child: ChildProcessWithoutNullStreams, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = ""
    const onData = (chunk: Buffer) => {
      output += chunk.toString()
      if (!output.includes(expected + "\n")) return
      cleanup()
      resolve()
    }
    const onExit = (code: number | null) => {
      cleanup()
      reject(
        new Error(`migration lock holder exited before ${expected} (${code}): ${output}${child.stderr.read() ?? ""}`),
      )
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      child.stdout.off("data", onData)
      child.off("exit", onExit)
      child.off("error", onError)
    }
    child.stdout.on("data", onData)
    child.on("exit", onExit)
    child.on("error", onError)
  })
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode)
  return new Promise((resolve, reject) => {
    child.once("exit", resolve)
    child.once("error", reject)
  })
}

describe("MigrationLock", () => {
  test("acquire creates the compatibility lockfile and release is idempotent", async () => {
    await using tmp = await tmpdir({ git: true })
    const db = path.join(tmp.path, "ax-code.db")
    const release = MigrationLock.acquire(db)
    expect(fs.existsSync(db + ".migrate.lock")).toBe(true)
    release()
    release()
    expect(fs.existsSync(db + ".migrate.lock")).toBe(false)
  })

  test("serializes independent processes", async () => {
    await using tmp = await tmpdir({ git: true })
    const db = path.join(tmp.path, "ax-code.db")
    const ownerRelease = MigrationLock.acquire(db)
    const ownerText = fs.readFileSync(db + ".migrate.lock", "utf-8")
    const holder = path.join(import.meta.dirname, "../fixture/migrate-lock-holder.ts")
    const child = spawn(process.execPath, ["--import", "tsx", holder, db, "0"], {
      cwd: path.join(import.meta.dirname, "../.."),
      stdio: ["pipe", "pipe", "pipe"],
    })
    try {
      await waitForLine(child, "attempting")
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(child.exitCode).toBeNull()
      expect(fs.readFileSync(db + ".migrate.lock", "utf-8")).toBe(ownerText)

      const acquired = waitForLine(child, "locked")
      ownerRelease()
      await acquired
      expect(await waitForExit(child)).toBe(0)
    } finally {
      ownerRelease()
      if (child.exitCode === null) child.kill()
    }
  })

  test("recovers both locks after a holder process crashes", async () => {
    await using tmp = await tmpdir({ git: true })
    const db = path.join(tmp.path, "ax-code.db")
    const holder = path.join(import.meta.dirname, "../fixture/migrate-lock-holder.ts")
    const child = spawn(process.execPath, ["--import", "tsx", holder, db, "60000"], {
      cwd: path.join(import.meta.dirname, "../.."),
      stdio: ["pipe", "pipe", "pipe"],
    })
    try {
      await waitForLine(child, "attempting")
      await waitForLine(child, "locked")
      child.kill()
      await waitForExit(child)

      const release = MigrationLock.acquire(db, { timeoutMs: 2_000 })
      release()
      expect(fs.existsSync(db + ".migrate.lock")).toBe(false)
    } finally {
      if (child.exitCode === null) child.kill()
    }
  })

  test("times out without stealing a live holder", async () => {
    await using tmp = await tmpdir({ git: true })
    const db = path.join(tmp.path, "ax-code.db")
    const release = MigrationLock.acquire(db)
    const original = fs.readFileSync(db + ".migrate.lock", "utf-8")
    expect(() => MigrationLock.acquire(db, { timeoutMs: 20 })).toThrow(/Timed out waiting for migration lock/)
    expect(fs.readFileSync(db + ".migrate.lock", "utf-8")).toBe(original)
    release()
  })

  test("release does not remove a replacement owner's lock", async () => {
    await using tmp = await tmpdir({ git: true })
    const db = path.join(tmp.path, "ax-code.db")
    const target = db + ".migrate.lock"
    const release = MigrationLock.acquire(db)
    const replacement = JSON.stringify({
      pid: process.pid,
      startedAt: Date.now(),
      host: os.hostname(),
      token: "replacement",
    })
    fs.writeFileSync(target, replacement)
    release()
    expect(fs.readFileSync(target, "utf-8")).toBe(replacement)
    fs.unlinkSync(target)
  })

  test("reclaims a lock whose same-host process is dead", async () => {
    await using tmp = await tmpdir({ git: true })
    const db = path.join(tmp.path, "ax-code.db")
    const child = spawnSync(process.execPath, ["-e", "process.exit(0)"])
    expect(child.status).toBe(0)
    fs.writeFileSync(
      db + ".migrate.lock",
      JSON.stringify({ pid: child.pid, startedAt: Date.now(), host: os.hostname() }),
    )
    const release = MigrationLock.acquire(db)
    release()
  })

  test("never steals an old same-host lock while its process is alive", async () => {
    await using tmp = await tmpdir({ git: true })
    const db = path.join(tmp.path, "ax-code.db")
    const target = db + ".migrate.lock"
    const original = JSON.stringify({
      pid: process.pid,
      startedAt: Date.now() - 60 * 60 * 1000,
      host: os.hostname(),
    })
    fs.writeFileSync(target, original)
    expect(() => MigrationLock.acquire(db, { timeoutMs: 20, pollMs: 1 })).toThrow(
      /Timed out waiting for migration lock/,
    )
    expect(fs.readFileSync(target, "utf-8")).toBe(original)
  })

  test("never steals a foreign-host lock based on age", async () => {
    await using tmp = await tmpdir({ git: true })
    const db = path.join(tmp.path, "ax-code.db")
    const target = db + ".migrate.lock"
    const original = JSON.stringify({
      pid: 999_999_999,
      startedAt: Date.now() - 60 * 60 * 1000,
      host: "another-host",
    })
    fs.writeFileSync(target, original)
    expect(() => MigrationLock.acquire(db, { timeoutMs: 20, pollMs: 1 })).toThrow(
      /Timed out waiting for migration lock/,
    )
    expect(fs.readFileSync(target, "utf-8")).toBe(original)
  })

  test("gives a fresh malformed lock a grace period before reclaiming it", async () => {
    await using tmp = await tmpdir({ git: true })
    const db = path.join(tmp.path, "ax-code.db")
    const target = db + ".migrate.lock"
    fs.writeFileSync(target, "partial json")
    expect(() => MigrationLock.acquire(db, { timeoutMs: 20, pollMs: 1, malformedGraceMs: 10_000 })).toThrow(
      /Timed out waiting for migration lock/,
    )
    expect(fs.readFileSync(target, "utf-8")).toBe("partial json")

    const release = MigrationLock.acquire(db, { malformedGraceMs: 0 })
    release()
    expect(fs.existsSync(target)).toBe(false)
  })
})
