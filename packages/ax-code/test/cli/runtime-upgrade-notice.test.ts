import { describe, expect, test } from "vitest"
import {
  renderStaleRuntimeServers,
  runtimeRestartCommand,
  staleRuntimeServers,
  type RuntimeServerRecord,
} from "../../src/cli/runtime-upgrade-notice"

const records: RuntimeServerRecord[] = [
  { directory: "/work/beta", version: "7.26.3" },
  { directory: "/work/alpha", version: "7.25.0" },
  { directory: "/work/gamma", version: "7.25.0" },
]

describe("stale runtime servers", () => {
  test("selects only servers whose version differs, sorted by directory", () => {
    expect(staleRuntimeServers(records, "7.26.3")).toEqual([
      { directory: "/work/alpha", version: "7.25.0", restartCommand: "ax-code runtime restart --dir /work/alpha" },
      { directory: "/work/gamma", version: "7.25.0", restartCommand: "ax-code runtime restart --dir /work/gamma" },
    ])
  })

  test("is empty when every server matches the new version", () => {
    expect(staleRuntimeServers([{ directory: "/work/a", version: "7.26.3" }], "7.26.3")).toEqual([])
  })

  test("treats an empty registry as nothing stale", () => {
    expect(staleRuntimeServers([], "7.26.3")).toEqual([])
  })

  test("builds the exact restart command for a directory", () => {
    expect(runtimeRestartCommand("/work/alpha")).toBe("ax-code runtime restart --dir /work/alpha")
  })
})

describe("stale runtime notice rendering", () => {
  test("prints one line per stale server with its restart command", () => {
    const lines = renderStaleRuntimeServers(staleRuntimeServers(records, "7.26.3"), "7.26.3")
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain("2 runtime servers")
    expect(lines[0]).toContain("v7.26.3")
    expect(lines[1]).toContain("/work/alpha")
    expect(lines[1]).toContain("ax-code runtime restart --dir /work/alpha")
    expect(lines[2]).toContain("/work/gamma")
  })

  test("uses the singular form for one stale server", () => {
    const lines = renderStaleRuntimeServers(
      staleRuntimeServers([{ directory: "/w", version: "1.0.0" }], "2.0.0"),
      "2.0.0",
    )
    expect(lines[0]).toContain("1 runtime server ")
    expect(lines[0]).not.toContain("1 runtime servers")
  })

  test("prints nothing when no server is stale", () => {
    expect(renderStaleRuntimeServers([], "7.26.3")).toEqual([])
  })
})
