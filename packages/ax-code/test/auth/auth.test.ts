import path from "path"
import { afterEach, expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import { Auth } from "../../src/auth"
import { Global } from "../../src/global"

const file = path.join(Global.Path.data, "auth.json")
const lockFile = `${file}.lock`

afterEach(async () => {
  await Bun.write(file, "{}")
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

test("all returns empty for corrupted auth file", async () => {
  await Bun.write(file, "{ invalid json")

  expect(await Auth.all()).toEqual({})
  expect(await Auth.get("anthropic")).toBeUndefined()
})

test("all filters invalid auth entries and keeps valid ones", async () => {
  await Bun.write(
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

test("set steals an abandoned auth lock owned by a dead process", async () => {
  await fs.writeFile(
    lockFile,
    JSON.stringify({
      host: process.env.HOSTNAME ?? "",
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

test("set unreferences lock polling timers while waiting for an active holder", async () => {
  const originalSetTimeout = globalThis.setTimeout
  const host = process.env.HOSTNAME ?? ""
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

  const killSpy = spyOn(process, "kill").mockImplementation(() => true as any)
  const nowSpy = spyOn(Date, "now").mockImplementation(() => {
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
