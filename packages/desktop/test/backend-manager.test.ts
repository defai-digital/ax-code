import { describe, expect, test } from "bun:test"
import { DesktopBackendManager } from "../src/lifecycle/backend-manager"
import { createAttachBackendPlan, createStartBackendPlan } from "../src/lifecycle/sidecar-plan"

describe("desktop backend manager", () => {
  test("starts a sidecar through injected headless lifecycle and records diagnostics", async () => {
    let closed = false
    const manager = new DesktopBackendManager({
      now: fixedClock([1, 2, 3, 4, 5, 6]),
      startBackend: async (options) => {
        options.onStdout?.("ready")
        return {
          url: "http://127.0.0.1:4444",
          headers: { Authorization: "Basic secret" },
          close: async () => {
            closed = true
          },
        }
      },
    })

    const connection = await manager.connect(createStartBackendPlan({ directory: "/workspace/ax-code" }))

    expect(connection).toMatchObject({
      url: "http://127.0.0.1:4444",
      mode: "start",
      loopbackOnly: true,
      generatedAuth: true,
    })
    expect(manager.diagnostics()).toMatchObject({
      status: "running",
      mode: "start",
      url: "http://127.0.0.1:4444",
    })
    expect(manager.exportLogs()).toContain("[stdout] ready")

    await manager.close()
    expect(closed).toBe(true)
    expect(manager.diagnostics().status).toBe("closed")
  })

  test("attaches without owning a backend process", async () => {
    const manager = new DesktopBackendManager({
      startBackend: async () => {
        throw new Error("should not start")
      },
    })

    const connection = await manager.connect(
      createAttachBackendPlan({ baseUrl: "http://127.0.0.1:4096/", authHeader: "Basic token" }),
    )

    expect(connection).toMatchObject({
      mode: "attach",
      url: "http://127.0.0.1:4096",
      headers: { authorization: "Basic token" },
    })

    await manager.close()
    expect(manager.exportLogs()).toContain("detached from backend")
  })

  test("records startup failure without leaking a running connection", async () => {
    const manager = new DesktopBackendManager({
      startBackend: async () => {
        throw new Error("boom")
      },
    })

    await expect(manager.connect(createStartBackendPlan({ directory: "/workspace/ax-code" }))).rejects.toThrow("boom")

    expect(manager.getConnection()).toBeUndefined()
    expect(manager.diagnostics()).toMatchObject({
      status: "failed",
      error: "boom",
    })
  })
})

function fixedClock(values: number[]) {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)] ?? 0
}
