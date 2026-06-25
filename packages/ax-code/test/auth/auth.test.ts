import path from "path"
import { afterEach, expect, test, vi } from "vitest"
import fs from "fs/promises"
import { Auth } from "../../src/auth"
import { Global } from "../../src/global"
import { currentLockHost } from "../../src/util/process-lock"

const file = path.join(Global.Path.data, "auth.json")
const lockFile = `${file}.lock`

afterEach(async () => {
  await fs.writeFile(file, "{}")
  await fs.unlink(lockFile).catch(() => undefined)
})

test("set normalizes trailing slashes in keys", async () => {
  await Auth.set("https://example.com/", {
    type: "wellknown",
    key: "TOKEN",
    token: "abc",
  })
  const data = await Auth.all()
  expect(data["https://example.com"]).toBeDefined()
  expect(data["https://example.com/"]).toBeUndefined()
})

test("set cleans up pre-existing trailing-slash entry", async () => {
  // Simulate a pre-fix entry with trailing slash
  await Auth.set("https://example.com/", {
    type: "wellknown",
    key: "TOKEN",
    token: "old",
  })
  // Re-login with normalized key (as the CLI does post-fix)
  await Auth.set("https://example.com", {
    type: "wellknown",
    key: "TOKEN",
    token: "new",
  })
  const data = await Auth.all()
  const keys = Object.keys(data).filter((k) => k.includes("example.com"))
  expect(keys).toEqual(["https://example.com"])
  const entry = data["https://example.com"]!
  expect(entry.type).toBe("wellknown")
  if (entry.type === "wellknown") expect(entry.token).toBe("new")
})

test("remove deletes both trailing-slash and normalized keys", async () => {
  await Auth.set("https://example.com", {
    type: "wellknown",
    key: "TOKEN",
    token: "abc",
  })
  await Auth.remove("https://example.com/")
  const data = await Auth.all()
  expect(data["https://example.com"]).toBeUndefined()
  expect(data["https://example.com/"]).toBeUndefined()
})

test("set and remove are no-ops on keys without trailing slashes", async () => {
  await Auth.set("anthropic", {
    type: "api",
    key: "sk-test",
  })
  const data = await Auth.all()
  expect(data["anthropic"]).toBeDefined()
  await Auth.remove("anthropic")
  const after = await Auth.all()
  expect(after["anthropic"]).toBeUndefined()
})

test("all does not overwrite corrupted auth file", async () => {
  const corrupted = "{ invalid json"
  await fs.writeFile(file, corrupted)

  await expect(Auth.all()).rejects.toMatchObject({ name: "AuthError" })
  await expect(Auth.get("anthropic")).rejects.toMatchObject({ name: "AuthError" })
  expect(await fs.readFile(file, "utf-8")).toBe(corrupted)
})

test("set does not overwrite corrupted auth file", async () => {
  const corrupted = "{ invalid json"
  await fs.writeFile(file, corrupted)

  await expect(
    Auth.set("anthropic", {
      type: "api",
      key: "sk-test",
    }),
  ).rejects.toMatchObject({ name: "AuthError" })

  expect(await fs.readFile(file, "utf-8")).toBe(corrupted)
})

test("remove does not overwrite corrupted auth file", async () => {
  const corrupted = "{ invalid json"
  await fs.writeFile(file, corrupted)

  await expect(Auth.remove("anthropic")).rejects.toMatchObject({ name: "AuthError" })

  expect(await fs.readFile(file, "utf-8")).toBe(corrupted)
})

test("all filters invalid auth entries and keeps valid ones", async () => {
  await fs.writeFile(
    file,
    JSON.stringify({
      anthropic: { type: "api", key: "sk-test" },
      broken: { type: "api", key: 1 },
    }),
  )

  const data = await Auth.all()
  expect(data["anthropic"]).toMatchObject({ type: "api", key: "sk-test" })
  expect(data["broken"]).toBeUndefined()
})

test("canary migration preserves entries that fail to decode instead of erasing them", async () => {
  await fs.writeFile(
    file,
    JSON.stringify({
      anthropic: { type: "api", key: "sk-test" },
      broken: { type: "api", key: 1 },
    }),
  )

  // No __canary present, so the first all() triggers the full-file migration
  // rewrite. The entry that fails to decode must survive on disk (it may be a
  // recoverable credential), not be silently deleted.
  await Auth.all()

  const onDisk = JSON.parse(await fs.readFile(file, "utf-8"))
  expect(onDisk.__canary).toBeDefined()
  expect(onDisk.anthropic).toBeDefined()
  expect(onDisk.broken).toBeDefined()
})

test("set steals an abandoned auth lock owned by a dead process", async () => {
  await fs.writeFile(
    lockFile,
    JSON.stringify({
      host: currentLockHost(),
      pid: 99999999,
      startedAt: Date.now(),
      token: "stale-lock",
    }),
  )

  await Auth.set("anthropic", {
    type: "api",
    key: "sk-test",
  })

  expect(await Auth.get("anthropic")).toMatchObject({ type: "api", key: "sk-test" })
})

test("set does not steal an auth lock when its body cannot be read", async () => {
  const authBefore = JSON.stringify({ anthropic: { type: "api", key: "sk-existing" } })
  const lockBefore = JSON.stringify({
    host: currentLockHost(),
    pid: process.pid + 1,
    startedAt: Date.now(),
    token: "active-holder",
  })
  await fs.writeFile(file, authBefore)
  await fs.writeFile(lockFile, lockBefore)

  const readError = Object.assign(new Error("auth lock is unreadable"), { code: "EACCES" })
  const readSpy = vi.spyOn(fs, "readFile").mockRejectedValueOnce(readError)

  try {
    await expect(
      Auth.set("anthropic", {
        type: "api",
        key: "sk-new",
      }),
    ).rejects.toMatchObject({ name: "AuthError" })
    expect(await fs.readFile(file, "utf-8")).toBe(authBefore)
    expect(await fs.readFile(lockFile, "utf-8")).toBe(lockBefore)
  } finally {
    readSpy.mockRestore()
  }
})

test("stale auth lock stealing claims and revalidates the stale snapshot before unlinking", async () => {
  const src = await fs.readFile(path.join(import.meta.dirname, "../../src/auth/index.ts"), "utf-8")
  const start = src.indexOf("async function removeStaleSnapshot")
  const end = src.indexOf("async function maybeSteal", start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const body = src.slice(start, end)

  expect(body).toContain("staleLockClaimFile(snapshot.text)")
  expect(body).toContain('fsPromises.open(claimFile, "wx")')
  expect(body).toContain("current !== snapshot.text")
  expect(body.indexOf("current !== snapshot.text")).toBeLessThan(body.indexOf("cleanupAuthLockFile()"))
})

test("set unreferences lock polling timers while waiting for an active holder", async () => {
  const originalSetTimeout = globalThis.setTimeout
  const host = currentLockHost()
  let unrefCalls = 0
  let nowCalls = 0

  await fs.writeFile(
    lockFile,
    JSON.stringify({
      host,
      pid: process.pid + 1,
      startedAt: 1,
      token: "busy-holder",
    }),
  )

  const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as any)
  const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
    nowCalls += 1
    return nowCalls >= 50 ? 6_001 : 1_000
  })

  globalThis.setTimeout = ((fn: (...args: any[]) => void, _ms?: number, ...args: any[]) => {
    originalSetTimeout(() => fn(...args), 0)
    return {
      unref() {
        unrefCalls += 1
        return this
      },
    } as any
  }) as typeof setTimeout

  try {
    await expect(
      Auth.set("anthropic", {
        type: "api",
        key: "sk-test",
      }),
    ).rejects.toBeDefined()
    expect(unrefCalls).toBeGreaterThan(0)
  } finally {
    globalThis.setTimeout = originalSetTimeout
    killSpy.mockRestore()
    nowSpy.mockRestore()
  }
})
