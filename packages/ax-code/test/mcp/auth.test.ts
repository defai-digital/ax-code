import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Global } from "../../src/global"
import { McpAuth } from "../../src/mcp/auth"

const authFile = path.join(Global.Path.data, "mcp-auth.json")

async function flushMicrotasks(count = 3) {
  for (let i = 0; i < count; i++) await Promise.resolve()
}

async function resetAuthFile() {
  await fs.rm(authFile, { force: true }).catch(() => undefined)
}

beforeEach(resetAuthFile)
afterEach(resetAuthFile)

describe("McpAuth.withLock", () => {
  test("releases idle key entries after queued work drains", async () => {
    const key = `mcp-auth:${Math.random().toString(36).slice(2)}`
    const order: string[] = []
    let releaseFirst!: () => void

    const first = McpAuth.withLock(key, async () => {
      order.push("first:start")
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      order.push("first:end")
    })

    const second = McpAuth.withLock(key, async () => {
      order.push("second")
    })

    await flushMicrotasks()
    expect(order).toEqual(["first:start"])

    releaseFirst()
    await Promise.all([first, second])

    expect(order).toEqual(["first:start", "first:end", "second"])
  })

  test("continues queued work and cleans up after a failure", async () => {
    const key = `mcp-auth:${Math.random().toString(36).slice(2)}`
    const order: string[] = []
    let releaseFirst!: () => void

    const first = McpAuth.withLock(key, async () => {
      order.push("first")
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      throw new Error("boom")
    })

    const second = McpAuth.withLock(key, async () => {
      order.push("second")
      return "ok"
    })

    await flushMicrotasks()
    expect(order).toEqual(["first"])

    releaseFirst()

    await expect(first).rejects.toThrow("boom")
    await expect(second).resolves.toBe("ok")
    expect(order).toEqual(["first", "second"])
  })
})

describe("McpAuth persistence", () => {
  test("creates auth file when it is missing", async () => {
    await McpAuth.set("server", {
      tokens: {
        accessToken: "access-token",
      },
    })

    expect(await McpAuth.get("server")).toMatchObject({
      tokens: {
        accessToken: "access-token",
      },
    })
  })

  test("does not overwrite malformed auth JSON during updates", async () => {
    const malformed = "{not json"
    await Bun.write(authFile, malformed)

    await expect(
      McpAuth.set("server", {
        tokens: {
          accessToken: "access-token",
        },
      }),
    ).rejects.toThrow("Failed to parse JSON")

    expect(await Bun.file(authFile).text()).toBe(malformed)
  })
})
