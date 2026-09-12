import { afterEach, describe, expect, test, vi } from "vitest"
import { signalBashProcessTree } from "../../src/tool/bash-process-cleanup"

const { taskkill } = vi.hoisted(() => ({ taskkill: vi.fn() }))
vi.mock("node:child_process", () => ({ spawnSync: taskkill }))

afterEach(() => {
  vi.restoreAllMocks()
  taskkill.mockReset()
})

function missingProcess() {
  return Object.assign(new Error("Missing process"), { code: "ESRCH" })
}

describe("synchronous bash process cleanup", () => {
  test("uses bounded Windows tree termination without negative PID signaling", () => {
    taskkill.mockReturnValue({ status: 0 })
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      throw missingProcess()
    })
    expect(signalBashProcessTree(42424, "SIGKILL", "win32")).toBe(true)
    expect(taskkill).toHaveBeenCalledWith("taskkill", ["/pid", "42424", "/f", "/t"], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 1000,
    })
    expect(kill).not.toHaveBeenCalled()
  })

  test("falls back to direct Windows signaling only when taskkill cannot be found", () => {
    taskkill.mockReturnValue({ status: null, error: Object.assign(new Error("Missing taskkill"), { code: "ENOENT" }) })
    const kill = vi.spyOn(process, "kill").mockReturnValue(true)
    expect(signalBashProcessTree(42424, "SIGKILL", "win32")).toBe(true)
    expect(kill.mock.calls).toEqual([[42424, "SIGKILL"]])
  })

  test.each([
    { status: 1 },
    { status: 128 },
    { status: null, error: Object.assign(new Error("Timed out"), { code: "ETIMEDOUT" }) },
  ])("does not signal a potentially reused PID after taskkill ran: %j", (result) => {
    taskkill.mockReturnValue(result)
    const kill = vi.spyOn(process, "kill").mockReturnValue(true)
    expect(signalBashProcessTree(42424, "SIGKILL", "win32")).toBe(false)
    expect(kill).not.toHaveBeenCalled()
  })

  test("contains synchronous taskkill errors", () => {
    taskkill.mockImplementation(() => {
      throw new Error("Spawn failed")
    })
    const kill = vi.spyOn(process, "kill").mockReturnValue(true)
    expect(signalBashProcessTree(42424, "SIGKILL", "win32")).toBe(false)
    expect(kill).not.toHaveBeenCalled()
  })

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])("rejects invalid PID %s before signaling", (pid) => {
    const kill = vi.spyOn(process, "kill").mockReturnValue(true)
    expect(signalBashProcessTree(pid, "SIGKILL", "win32")).toBe(false)
    expect(taskkill).not.toHaveBeenCalled()
    expect(kill).not.toHaveBeenCalled()
  })

  test("reports a missing Windows process without throwing", () => {
    taskkill.mockReturnValue({ status: null, error: Object.assign(new Error("Missing taskkill"), { code: "ENOENT" }) })
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw missingProcess()
    })
    expect(signalBashProcessTree(42424, "SIGKILL", "win32")).toBe(false)
  })

  test("preserves POSIX group signaling", () => {
    const kill = vi.spyOn(process, "kill").mockReturnValue(true)
    expect(signalBashProcessTree(42424, "SIGTERM", "linux")).toBe(true)
    expect(kill.mock.calls).toEqual([[-42424, "SIGTERM"]])
    expect(taskkill).not.toHaveBeenCalled()
  })

  test("does not signal a possibly reused POSIX PID after its group is gone", () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      throw missingProcess()
    })
    expect(signalBashProcessTree(42424, "SIGKILL", "darwin")).toBe(false)
    expect(kill.mock.calls).toEqual([[-42424, "SIGKILL"]])
  })
})
