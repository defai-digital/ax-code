import path from "path"
import { afterEach, expect, test, vi } from "vitest"
import fs from "fs/promises"
import { Auth } from "../../src/auth"
import { createCanary, isEncrypted, verifyCanary } from "../../src/auth/encryption"
import { Global } from "../../src/global"
import { currentLockHost } from "../../src/util/process-lock"
import { Filesystem } from "../../src/util/filesystem"

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

test("all re-encrypts a plaintext key left beside a valid canary", async () => {
  await fs.writeFile(
    file,
    JSON.stringify({
      __canary: createCanary(),
      anthropic: { type: "api", key: "sk-test" },
    }),
  )

  const data = await Auth.all()
  expect(data["anthropic"]).toMatchObject({ type: "api", key: "sk-test" })

  const raw = await fs.readFile(file, "utf-8")
  expect(raw).not.toContain("sk-test")
  const onDisk = JSON.parse(raw)
  expect(isEncrypted(onDisk.anthropic.key)).toBe(true)
})

test("coalesces concurrent first-run reads while creating the auth canary", async () => {
  await fs.writeFile(file, "{}")

  const [first, second] = await Promise.all([Auth.all(), Auth.all()])

  expect(first).toEqual({})
  expect(second).toEqual({})
  expect(JSON.parse(await fs.readFile(file, "utf-8")).__canary).toBeDefined()
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

test("canary verification failure falls through to per-key decryption", async () => {
  await Auth.set("anthropic", { type: "api", key: "sk-test" })
  await Auth.set("openai", { type: "api", key: "sk-other" })

  // Corrupt the canary on disk (e.g. a partial write during an upgrade)
  // without touching the credentials themselves. A poisoned canary must not
  // mask entries that still decrypt fine (#392).
  const data = JSON.parse(await fs.readFile(file, "utf-8"))
  data.__canary = "corrupt"
  await fs.writeFile(file, JSON.stringify(data))

  const result = await Auth.all()
  expect(result["anthropic"]).toMatchObject({ type: "api", key: "sk-test" })
  expect(result["openai"]).toMatchObject({ type: "api", key: "sk-other" })
  expect(await Auth.decryptionFailures()).toEqual([])

  // The invalid canary is rewritten during migration so later reads trust it.
  const onDisk = JSON.parse(await fs.readFile(file, "utf-8"))
  expect(onDisk.__canary).not.toBe("corrupt")
  expect(verifyCanary(onDisk.__canary)).toBe(true)
})

test("canary failure still records entries that genuinely fail decryption", async () => {
  await Auth.set("anthropic", { type: "api", key: "sk-test" })

  const data = JSON.parse(await fs.readFile(file, "utf-8"))
  data.__canary = "corrupt"
  // A well-formed EncryptedValue whose ciphertext cannot decrypt with any
  // derivable key — the shape a real crypto-runtime change would produce.
  data["stale"] = {
    type: "api",
    key: {
      encrypted: Buffer.alloc(24).toString("base64"),
      iv: Buffer.alloc(16).toString("base64"),
      salt: Buffer.alloc(32).toString("base64"),
      tag: Buffer.alloc(16).toString("base64"),
      version: 2,
    },
  }
  await fs.writeFile(file, JSON.stringify(data))

  const result = await Auth.all()
  expect(result["anthropic"]).toMatchObject({ type: "api", key: "sk-test" })
  expect(result["stale"]).toBeUndefined()
  expect(await Auth.decryptionFailures()).toEqual(["stale"])

  // The undecryptable entry is preserved on disk for potential recovery.
  const onDisk = JSON.parse(await fs.readFile(file, "utf-8"))
  expect(onDisk["stale"]).toBeDefined()
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

test("set does not steal a freshly created auth lock with a partial body", async () => {
  await fs.writeFile(lockFile, "{")
  const now = vi.spyOn(Date, "now")
  now.mockReturnValueOnce(1_000).mockReturnValueOnce(1_000).mockReturnValue(6_001)

  try {
    await expect(
      Auth.set("anthropic", {
        type: "api",
        key: "sk-new",
      }),
    ).rejects.toMatchObject({ name: "AuthError" })
    expect(await fs.readFile(lockFile, "utf-8")).toBe("{")
  } finally {
    now.mockRestore()
  }
})

test("remove drops a coalesced all() so later get does not return deleted credentials", async () => {
  await Auth.set("muse-cli", { type: "api", key: "stale-key" })

  const originalReadJson = Filesystem.readJson.bind(Filesystem)
  let releaseRead!: () => void
  const readReleased = new Promise<void>((resolve) => {
    releaseRead = resolve
  })
  let initialReadObserved!: () => void
  const initialRead = new Promise<void>((resolve) => {
    initialReadObserved = resolve
  })
  let intercepted = false
  const readSpy = vi.spyOn(Filesystem, "readJson").mockImplementation(async (target) => {
    if (target === file && !intercepted) {
      intercepted = true
      initialReadObserved()
      await readReleased
    }
    return originalReadJson(target)
  })

  try {
    const inflight = Auth.all()
    await initialRead
    await Auth.remove("muse-cli")
    await expect(Auth.get("muse-cli")).resolves.toBeUndefined()
    releaseRead()
    await inflight
    expect(await Auth.get("muse-cli")).toBeUndefined()
  } finally {
    releaseRead()
    readSpy.mockRestore()
    await Auth.remove("muse-cli").catch(() => undefined)
  }
})

test("canary migration preserves credentials written after its initial read", async () => {
  await fs.writeFile(file, JSON.stringify({ anthropic: { type: "api", key: "sk-existing" } }))

  const originalReadJson = Filesystem.readJson.bind(Filesystem)
  let releaseRead!: () => void
  const readReleased = new Promise<void>((resolve) => {
    releaseRead = resolve
  })
  let initialReadObserved!: () => void
  const initialRead = new Promise<void>((resolve) => {
    initialReadObserved = resolve
  })
  let intercepted = false
  const readSpy = vi.spyOn(Filesystem, "readJson").mockImplementation(async (target) => {
    const value = await originalReadJson(target)
    if (target === file && !intercepted) {
      intercepted = true
      initialReadObserved()
      await readReleased
    }
    return value
  })

  try {
    const migration = Auth.all()
    await initialRead
    await Auth.set("openai", { type: "api", key: "sk-concurrent" })
    releaseRead()
    await migration

    expect(await Auth.get("openai")).toMatchObject({ type: "api", key: "sk-concurrent" })
  } finally {
    releaseRead()
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

// Mirrors test/util/filelock.test.ts. Polling timers must stay ref'd: the
// auth lock poll is awaited by Auth.set, so if its timer is the only pending
// work an unref lets Node drain the event loop and exit with the caller's
// promise unsettled. Termination is guaranteed by the bounded deadline in the
// poll loop, not by the unref. See the sleep() note in packages/util/src/timeout.ts.
test("set keeps lock polling timers referenced while waiting for an active holder", async () => {
  const originalSetTimeout = globalThis.setTimeout
  const host = currentLockHost()
  let unrefCalls = 0
  let pollTimers = 0
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
    pollTimers += 1
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
    // The loop did poll...
    expect(pollTimers).toBeGreaterThan(0)
    // ...and never unref'd, so an awaited Auth.set cannot be silently dropped.
    expect(unrefCalls).toBe(0)
  } finally {
    globalThis.setTimeout = originalSetTimeout
    killSpy.mockRestore()
    nowSpy.mockRestore()
  }
})

test("API key rollback preserves a peer write of the same plaintext", async () => {
  await Auth.set("provider", { type: "api", key: "old-value" })
  const rollback = await Auth.setApiKeyWithRollback("provider", "new-value")
  await Auth.set("provider", { type: "api", key: "new-value" })
  expect(await rollback()).toBe(false)
  expect(await Auth.get("provider")).toEqual({ type: "api", key: "new-value" })
})

test("API key rollback restores its predecessor and preserves unrelated provider changes", async () => {
  await Auth.set("provider", { type: "api", key: "old-value" })
  const rollback = await Auth.setApiKeyWithRollback("provider/", "new-value")
  await Auth.set("other", { type: "api", key: "other-value" })
  expect(await rollback()).toBe(true)
  expect(await Auth.get("provider")).toEqual({ type: "api", key: "old-value" })
  expect(await Auth.get("other")).toEqual({ type: "api", key: "other-value" })
  await Auth.set("provider", { type: "api", key: "later-value" })
  await rollback()
  expect(await Auth.get("provider")).toEqual({ type: "api", key: "later-value" })
})

test("API key rollback does not recreate a provider removed by a peer", async () => {
  await Auth.set("provider", { type: "api", key: "old-value" })
  const rollback = await Auth.setApiKeyWithRollback("provider", "new-value")
  await Auth.remove("provider")
  expect(await rollback()).toBe(false)
  expect(await Auth.get("provider")).toBeUndefined()
})

test("API key rollback re-encrypts a legacy plaintext predecessor", async () => {
  await fs.writeFile(file, JSON.stringify({ __canary: createCanary(), provider: { type: "api", key: "legacy-value" } }))
  const rollback = await Auth.setApiKeyWithRollback("provider", "new-value")
  expect(await rollback()).toBe(true)
  expect(await fs.readFile(file, "utf8")).not.toContain("legacy-value")
  expect(await Auth.get("provider")).toEqual({ type: "api", key: "legacy-value" })
})

test("API key rollback preserves an undecodable predecessor for recovery", async () => {
  const previous = { type: "api", key: { encrypted: "corrupted", iv: "", salt: "", tag: "", version: 2 } }
  await fs.writeFile(file, JSON.stringify({ __canary: createCanary(), provider: previous }))
  const rollback = await Auth.setApiKeyWithRollback("provider", "new-value")
  expect(await rollback()).toBe(true)
  const stored = await Filesystem.readJson<Record<string, unknown>>(file)
  expect(stored.provider).toEqual(previous)
})

test("API key rollback setup rejects an empty key without changing credentials", async () => {
  await Auth.set("provider", { type: "api", key: "old-value" })
  await expect(Auth.setApiKeyWithRollback("provider", "")).rejects.toMatchObject({ name: "AuthError" })
  expect(await Auth.get("provider")).toEqual({ type: "api", key: "old-value" })
})

test("prepared removal clears captured aliases and preserves unrelated provider updates", async () => {
  await Auth.set("provider", { type: "api", key: "old-value" })
  const data = await Filesystem.readJson<Record<string, unknown>>(file)
  data["provider/"] = { type: "api", key: "legacy-alias" }
  await fs.writeFile(file, JSON.stringify(data))
  const before = await fs.readFile(file, "utf8")
  const remove = await Auth.prepareRemoval("provider/")
  expect(await fs.readFile(file, "utf8")).toBe(before)
  await Auth.set("other", { type: "api", key: "other-value" })
  expect(await remove()).toBe(true)
  const stored = await Filesystem.readJson<Record<string, unknown>>(file)
  expect(Object.hasOwn(stored, "provider")).toBe(false)
  expect(Object.hasOwn(stored, "provider/")).toBe(false)
  expect(await Auth.get("other")).toEqual({ type: "api", key: "other-value" })
  await Auth.set("provider", { type: "api", key: "later-value" })
  expect(await remove()).toBe(true)
  expect(await Auth.get("provider")).toEqual({ type: "api", key: "later-value" })
})

test.each(["old-value", "new-value"])("prepared removal preserves a peer credential write (%s)", async (key) => {
  await Auth.set("provider", { type: "api", key: "old-value" })
  const remove = await Auth.prepareRemoval("provider")
  await Auth.set("provider", { type: "api", key })
  expect(await remove()).toBe(false)
  expect(await Auth.get("provider")).toEqual({ type: "api", key })
})

test("prepared removal preserves a new alias beside an unchanged canonical entry", async () => {
  await Auth.set("provider", { type: "api", key: "old-value" })
  const remove = await Auth.prepareRemoval("provider")
  const data = await Filesystem.readJson<Record<string, unknown>>(file)
  data["provider/"] = { type: "api", key: "peer-alias" }
  await fs.writeFile(file, JSON.stringify(data))
  expect(await remove()).toBe(false)
  expect(await Filesystem.readJson(file)).toEqual(data)
})

test("prepared removal distinguishes an absent credential from a later connection", async () => {
  const absent = await Auth.prepareRemoval("provider")
  expect(await absent()).toBe(true)
  const beforeConnect = await Auth.prepareRemoval("provider")
  await Auth.set("provider", { type: "api", key: "peer-value" })
  expect(await beforeConnect()).toBe(false)
  expect(await Auth.get("provider")).toEqual({ type: "api", key: "peer-value" })
})

test("a peer's completed removal satisfies a prepared removal", async () => {
  await Auth.set("provider", { type: "api", key: "old-value" })
  const remove = await Auth.prepareRemoval("provider")
  await Auth.remove("provider")
  expect(await remove()).toBe(true)
  expect(await Auth.get("provider")).toBeUndefined()
})

test("prepared removal drops an in-flight read of a credential a peer has already removed", async () => {
  await Auth.set("provider", { type: "api", key: "old-value" })
  const remove = await Auth.prepareRemoval("provider")
  const read = Filesystem.readJson
  const reading = Promise.withResolvers<void>()
  const resume = Promise.withResolvers<void>()
  const readSpy = vi.spyOn(Filesystem, "readJson").mockImplementationOnce(async (target) => {
    const data = await read(target)
    reading.resolve()
    await resume.promise
    return data
  })
  const stale = Auth.all()
  let fresh: Promise<Auth.Info | undefined>
  try {
    await reading.promise
    const data = await read<Record<string, unknown>>(file)
    delete data.provider
    // Simulate a peer's atomic write without invalidating this process's cache.
    await Filesystem.writeJson(file, data, 0o600)
    expect(await remove()).toBe(true)
    fresh = Auth.get("provider")
  } finally {
    resume.resolve()
    readSpy.mockRestore()
    await stale
  }
  expect(await fresh).toBeUndefined()
})

test.each(["", "__canary"])("prepared removal rejects a reserved or empty provider ID (%s)", async (providerID) => {
  await Auth.set("provider", { type: "api", key: "old-value" })
  const before = await fs.readFile(file, "utf8")
  await expect(Auth.prepareRemoval(providerID)).rejects.toMatchObject({ name: "AuthError" })
  expect(await fs.readFile(file, "utf8")).toBe(before)
})

test("prepared removal can clear an undecodable credential without decrypting it", async () => {
  await fs.writeFile(file, JSON.stringify({ provider: { type: "api", key: { encrypted: "corrupt" } } }))
  const remove = await Auth.prepareRemoval("provider")
  expect(await remove()).toBe(true)
  expect(await Filesystem.readJson(file)).toEqual({})
})

test("a failed prepared removal preserves credentials and cannot retry against a later connection", async () => {
  await Auth.set("provider", { type: "api", key: "old-value" })
  const remove = await Auth.prepareRemoval("provider")
  const failure = new Error("Auth publication failed")
  const write = vi.spyOn(Filesystem, "writeJson").mockRejectedValueOnce(failure)
  try {
    await expect(remove()).rejects.toMatchObject({ name: "AuthError", data: { cause: failure } })
    expect(write).toHaveBeenCalledOnce()
  } finally {
    write.mockRestore()
  }
  expect(await Auth.get("provider")).toEqual({ type: "api", key: "old-value" })
  await Auth.set("provider", { type: "api", key: "peer-value" })
  await expect(remove()).rejects.toMatchObject({ name: "AuthError" })
  expect(await Auth.get("provider")).toEqual({ type: "api", key: "peer-value" })
})

test("auth writes recreate their data directory before acquiring the file lock", async () => {
  await Auth.set("seed", { type: "api", key: "seed-value" })
  const moved = `${Global.Path.data}.before-lock`
  await fs.rename(Global.Path.data, moved)
  try {
    await Auth.set("provider", { type: "api", key: "new-value" })
    expect(await Auth.get("provider")).toEqual({ type: "api", key: "new-value" })
  } finally {
    await fs.rm(Global.Path.data, { recursive: true, force: true })
    await fs.rename(moved, Global.Path.data)
  }
})
