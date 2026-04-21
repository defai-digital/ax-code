import { describe, expect, test } from "bun:test"
import { findByID, findWorkspace, sessionRuntimeStatus } from "../../../src/cli/cmd/tui/context/sync-query"

describe("tui sync query", () => {
  test("finds sorted entities by id", () => {
    expect(findByID([{ id: "ses_1" }, { id: "ses_2" }], "ses_2")).toEqual({ id: "ses_2" })
    expect(findByID([{ id: "ses_1" }, { id: "ses_2" }], "ses_9")).toBeUndefined()
  })

  test("derives session runtime status from compacting state and latest message", () => {
    expect(sessionRuntimeStatus(undefined, [])).toBe("idle")
    expect(sessionRuntimeStatus({ time: { compacting: true } }, [])).toBe("compacting")
    expect(sessionRuntimeStatus({ time: {} }, [])).toBe("idle")
    expect(
      sessionRuntimeStatus(
        { time: {} },
        [
          { role: "assistant", time: { completed: true } },
          { role: "user", time: {} },
        ],
      ),
    ).toBe("working")
    expect(sessionRuntimeStatus({ time: {} }, [{ role: "assistant", time: { completed: false } }])).toBe("working")
    expect(sessionRuntimeStatus({ time: {} }, [{ role: "assistant", time: { completed: true } }])).toBe("idle")
  })

  test("finds a workspace only when it exists", () => {
    expect(findWorkspace(["/tmp/a", "/tmp/b"], "/tmp/b")).toBe("/tmp/b")
    expect(findWorkspace(["/tmp/a", "/tmp/b"], "/tmp/c")).toBeUndefined()
  })
})
