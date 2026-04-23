import { describe, expect, test } from "bun:test"
import { getDoctorDatabaseCheck } from "../../src/cli/cmd/doctor-storage"

describe("getDoctorDatabaseCheck", () => {
  test("reports the active bundled database path", async () => {
    const check = await getDoctorDatabaseCheck({
      databasePath: "/tmp/ax-code/ax-code.db",
      exists: async (target) => target === "/tmp/ax-code/ax-code.db",
    })

    expect(check).toEqual({
      name: "Data directory",
      status: "ok",
      detail: "/tmp/ax-code/ax-code.db (bundled state)",
    })
  })

  test("warns when source and bundled databases both exist", async () => {
    const check = await getDoctorDatabaseCheck({
      databasePath: "/tmp/ax-code/ax-code.db",
      exists: async (target) => target === "/tmp/ax-code/ax-code.db" || target === "/tmp/ax-code/ax-code-local.db",
    })

    expect(check.status).toBe("warn")
    expect(check.detail).toContain("/tmp/ax-code/ax-code.db (bundled state)")
    expect(check.detail).toContain("source/dev state also exists at /tmp/ax-code/ax-code-local.db")
    expect(check.detail).toContain("do not share session state")
  })

  test("marks the source database as not created yet when absent", async () => {
    const check = await getDoctorDatabaseCheck({
      databasePath: "/tmp/ax-code/ax-code-local.db",
      exists: async () => false,
    })

    expect(check).toEqual({
      name: "Data directory",
      status: "ok",
      detail: "/tmp/ax-code/ax-code-local.db (source/dev state, not created yet)",
    })
  })
})
