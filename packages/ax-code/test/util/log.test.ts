import { describe, expect, test } from "bun:test"
import { Log } from "../../src/util/log"

describe("Log.stampedName", () => {
  test("keeps component-scoped names distinct within the same second", () => {
    const now = new Date("2026-04-22T01:54:03.649Z")

    expect(Log.stampedName("main", now, "run1")).toBe("2026-04-22T015403-649-main-run1")
    expect(Log.stampedName("tui-worker", now, "run1")).toBe("2026-04-22T015403-649-tui-worker-run1")
    expect(Log.stampedName("main", now, "run1")).not.toBe(Log.stampedName("tui-worker", now, "run1"))
  })

  test("keeps same-component names distinct when the caller provides a different run id", () => {
    const now = new Date("2026-04-22T01:54:03.649Z")

    expect(Log.stampedName("main", now, "run1")).not.toBe(Log.stampedName("main", now, "run2"))
  })
})
