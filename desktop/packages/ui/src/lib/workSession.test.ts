import { describe, expect, test } from "vitest"
import { resolveWorkSurfaceAgent, workSurfaceSessionIntent } from "./workSession"

describe("workSurfaceSessionIntent", () => {
  test("Work surface creates a Work agent session with product metadata", () => {
    expect(workSurfaceSessionIntent("work")).toEqual({
      agent: "work",
      metadata: { work: { version: 1, computer: false } },
    })
  })

  test("Code surface does not attach Work metadata", () => {
    expect(workSurfaceSessionIntent("code")).toBeNull()
  })

  test("resolveWorkSurfaceAgent prefers explicit agent then Work default", () => {
    expect(resolveWorkSurfaceAgent({ surface: "work", fallbackAgent: "build" })).toBe("work")
    expect(resolveWorkSurfaceAgent({ surface: "work", explicitAgent: "explore", fallbackAgent: "build" })).toBe(
      "explore",
    )
    expect(resolveWorkSurfaceAgent({ surface: "code", fallbackAgent: "build" })).toBe("build")
  })
})
