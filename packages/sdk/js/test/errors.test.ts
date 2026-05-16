import { describe, expect, test } from "bun:test"
import {
  AxCodeError,
  ProviderError,
  TimeoutError,
  ToolError,
  PermissionError,
  AgentNotFoundError,
  DisposedError,
} from "../src/programmatic/types"

describe("error classes", () => {
  test("AxCodeError carries a code", () => {
    const e = new AxCodeError("test", "TEST_CODE")
    expect(e.message).toBe("test")
    expect(e.code).toBe("TEST_CODE")
    expect(e.name).toBe("AxCodeError")
    expect(e instanceof Error).toBe(true)
  })

  test("ProviderError.isRetryable is true for 429 and 5xx", () => {
    expect(new ProviderError("rate", { status: 429 }).isRetryable).toBe(true)
    expect(new ProviderError("server", { status: 500 }).isRetryable).toBe(true)
    expect(new ProviderError("server", { status: 502 }).isRetryable).toBe(true)
    expect(new ProviderError("auth", { status: 401 }).isRetryable).toBe(false)
    expect(new ProviderError("unknown").isRetryable).toBe(false)
  })

  test("TimeoutError carries the timeout value", () => {
    const e = new TimeoutError(5000, "agent.run")
    expect(e.timeout).toBe(5000)
    expect(e.message).toContain("5000ms")
    expect(e.code).toBe("TIMEOUT")
  })

  test("ToolError carries the tool name", () => {
    const e = new ToolError("bash", "command not found")
    expect(e.tool).toBe("bash")
    expect(e.message).toContain("bash")
    expect(e.code).toBe("TOOL_ERROR")
  })

  test("PermissionError carries permission and patterns", () => {
    const e = new PermissionError("external_directory", ["/etc/*"])
    expect(e.permission).toBe("external_directory")
    expect(e.patterns).toEqual(["/etc/*"])
    expect(e.code).toBe("PERMISSION_DENIED")
  })

  test("AgentNotFoundError carries agent name and available list", () => {
    const e = new AgentNotFoundError("nonexistent", ["build", "security", "debug"])
    expect(e.agent).toBe("nonexistent")
    expect(e.available).toEqual(["build", "security", "debug"])
    expect(e.message).toContain("nonexistent")
  })

  test("DisposedError has the right code", () => {
    const e = new DisposedError()
    expect(e.code).toBe("DISPOSED")
    expect(e.message).toContain("disposed")
  })

  test("all error classes extend AxCodeError", () => {
    expect(new ProviderError("x") instanceof AxCodeError).toBe(true)
    expect(new TimeoutError(1) instanceof AxCodeError).toBe(true)
    expect(new ToolError("t", "m") instanceof AxCodeError).toBe(true)
    expect(new PermissionError("p") instanceof AxCodeError).toBe(true)
    expect(new AgentNotFoundError("a") instanceof AxCodeError).toBe(true)
    expect(new DisposedError() instanceof AxCodeError).toBe(true)
  })
})
