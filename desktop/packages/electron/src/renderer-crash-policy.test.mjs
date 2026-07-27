import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { createRendererCrashPolicy } = require("./renderer-crash-policy.js")

describe("createRendererCrashPolicy", () => {
  test("allows reloads up to the configured crash limit", () => {
    const policy = createRendererCrashPolicy({ maxReloads: 2 })

    expect(policy.shouldReload()).toBe(true)
    expect(policy.beginReload()).toBe(true)
    expect(policy.crashReloads).toBe(1)

    expect(policy.beginReload()).toBe(true)
    expect(policy.crashReloads).toBe(2)

    expect(policy.shouldReload()).toBe(false)
    expect(policy.beginReload()).toBe(false)
    expect(policy.crashReloads).toBe(3)
  })

  test("resets the crash counter only after a stability window", () => {
    const policy = createRendererCrashPolicy({ maxReloads: 1 })

    expect(policy.beginReload()).toBe(true)

    expect(policy.crashReloads).toBe(1)
    expect(policy.shouldReload()).toBe(false)
    policy.markStable()
    expect(policy.crashReloads).toBe(0)
    expect(policy.shouldReload()).toBe(true)
  })

  test("does not reload while quitting", () => {
    const policy = createRendererCrashPolicy({ maxReloads: 2 })

    expect(policy.shouldReload({ quitting: true })).toBe(false)
    expect(policy.shouldReload()).toBe(true)
  })

  test("defaults to three reloads", () => {
    const policy = createRendererCrashPolicy()

    expect(policy.beginReload()).toBe(true)
    expect(policy.beginReload()).toBe(true)
    expect(policy.beginReload()).toBe(true)
    expect(policy.shouldReload()).toBe(false)
  })

  test("main process starts a new stability window after every successful renderer load", async () => {
    const mainSource = await readFile(new URL("./main.js", import.meta.url), "utf8")
    const didFinishLoadHandler = mainSource.match(
      /webContents\.on\("did-finish-load",\s*\(\)\s*=>\s*\{(?<body>[\s\S]*?)^\s*\}\)/m,
    )?.groups?.body

    expect(didFinishLoadHandler).toBeDefined()
    expect(didFinishLoadHandler).toContain("scheduleRendererStabilityReset()")

    const initialLoadTail = mainSource.match(/await mainWindow\.loadURL\(rendererUrl\)(?<tail>[\s\S]{0,100})/)?.groups
      ?.tail
    expect(initialLoadTail).not.toContain("scheduleRendererStabilityReset()")
  })
})
