import { beforeEach, describe, expect, test } from "vitest"
import { ScopedFlag, isScopedFlagName } from "../../src/flag/scoped"

describe("ScopedFlag", () => {
  let currentDirectory: string | undefined

  beforeEach(() => {
    currentDirectory = undefined
    ScopedFlag.setDirectoryResolver(() => currentDirectory)
    delete process.env["AX_CODE_AUTONOMOUS"]
  })

  test("isScopedFlagName accepts only the scoped feature flags", () => {
    expect(isScopedFlagName("AX_CODE_AUTONOMOUS")).toBe(true)
    expect(isScopedFlagName("AX_CODE_SUPER_LONG")).toBe(true)
    expect(isScopedFlagName("AX_CODE_ISOLATION_MODE")).toBe(false)
  })

  test("keeps values isolated per directory", () => {
    currentDirectory = "/project-a"
    ScopedFlag.recordCurrent("AX_CODE_AUTONOMOUS", false)

    // Directory A sees its own value; directory B falls back to the
    // process-global flag (default on) instead of inheriting A's toggle.
    expect(ScopedFlag.autonomous()).toBe(false)
    currentDirectory = "/project-b"
    expect(ScopedFlag.autonomous()).toBe(true)
  })

  test("scoped value shields a directory from another directory's env write", () => {
    currentDirectory = "/project-b"
    ScopedFlag.recordCurrent("AX_CODE_AUTONOMOUS", true)

    // Directory A toggles autonomous off, which also rewrites the
    // process-global env (last-writer-wins). B must keep its own value.
    currentDirectory = "/project-a"
    ScopedFlag.recordCurrent("AX_CODE_AUTONOMOUS", false)
    process.env["AX_CODE_AUTONOMOUS"] = "false"

    expect(ScopedFlag.autonomous()).toBe(false)
    currentDirectory = "/project-b"
    expect(ScopedFlag.autonomous()).toBe(true)
  })

  test("falls back to the env flag outside an instance context", () => {
    currentDirectory = undefined
    process.env["AX_CODE_AUTONOMOUS"] = "false"
    expect(ScopedFlag.autonomous()).toBe(false)
  })

  test("superLong returns undefined when nothing was recorded", () => {
    currentDirectory = "/project-a"
    expect(ScopedFlag.superLong()).toBeUndefined()
    ScopedFlag.recordCurrent("AX_CODE_SUPER_LONG", true)
    expect(ScopedFlag.superLong()).toBe(true)
  })

  test("marks a flag as managed once any directory records it", () => {
    currentDirectory = "/project-a"
    ScopedFlag.recordCurrent("AX_CODE_SUPER_LONG", true)
    expect(ScopedFlag.isManaged("AX_CODE_SUPER_LONG")).toBe(true)
  })
})
