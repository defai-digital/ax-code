import { describe, expect, test } from "vitest"
import * as path from "node:path"
import {
  TERMINAL_NAME,
  devLauncherArgs,
  resolveAxCodeTarget,
  terminalLaunch,
  terminalLaunchEnv,
} from "../src/terminal-launch"

// The package directory — its grandparent is the real monorepo root, so
// resolveAxCodeTarget detects the dev checkout for real.
const extensionPath = path.resolve(__dirname, "..")

describe("resolveAxCodeTarget", () => {
  test("prefers an existing axCode.binaryPath override", () => {
    const target = resolveAxCodeTarget({ binaryPath: process.execPath, extensionPath })
    expect(target).toEqual({ kind: "binary", command: process.execPath })
  })

  test("ignores a binaryPath that does not exist and detects the monorepo", () => {
    const target = resolveAxCodeTarget({ binaryPath: "/nonexistent/ax-code", extensionPath })
    expect(target.kind).toBe("dev")
    if (target.kind === "dev") {
      expect(target.entry).toContain(path.join("packages", "ax-code", "src", "index-node-tui.ts"))
      expect(target.cwd).toContain(path.join("packages", "ax-code"))
    }
  })

  test("falls back to PATH outside a monorepo checkout", () => {
    expect(resolveAxCodeTarget({ binaryPath: "", extensionPath: "/nonexistent/ext" })).toEqual({ kind: "path" })
  })

  test("requires the pnpm-workspace.yaml marker, not just the entry file", () => {
    // Crafted layout: entry exists two levels up but no workspace marker.
    const target = resolveAxCodeTarget({ binaryPath: "", extensionPath: path.join(process.cwd(), "src") })
    expect(target.kind).toBe("path")
  })
})

describe("terminalLaunch", () => {
  test("launches an explicit binary directly without shell quoting", () => {
    expect(terminalLaunch({ kind: "binary", command: "/opt/my tools/ax-code" })).toEqual({
      kind: "direct",
      shellPath: "/opt/my tools/ax-code",
      shellArgs: [],
    })
  })

  test("PATH fallback launches through the user's shell", () => {
    expect(terminalLaunch({ kind: "path" })).toEqual({ kind: "shell", command: "ax-code" })
  })

  test("dev target launches from source via node + tsx + solid loader", () => {
    const target = resolveAxCodeTarget({ binaryPath: "", extensionPath })
    const launch = terminalLaunch(target)
    expect(launch.kind).toBe("direct")
    if (launch.kind !== "direct") throw new Error("expected a direct dev launch")
    expect(launch.shellPath).toBe(process.execPath)
    expect(launch.shellArgs).toContain("--experimental-ffi")
    expect(launch.shellArgs).toContain("--conditions=node")
    expect(launch.shellArgs.join(" ")).toContain("tsx")
    expect(launch.shellArgs.join(" ")).toContain("solid-loader.mjs")
    expect(launch.shellArgs.join(" ")).toContain("index-node-tui.ts")
    // TUI launch — `serve` belongs to the chat backend, not the terminal.
    expect(launch.shellArgs).not.toContain("serve")
  })
})

describe("devLauncherArgs / terminalLaunchEnv", () => {
  // Real monorepo cwd — devLauncherArgs resolves the tsx loader through it.
  const resolved = resolveAxCodeTarget({ binaryPath: "", extensionPath })
  if (resolved.kind !== "dev") throw new Error("expected the monorepo dev target")
  const target = resolved

  test("produces the node loader argument list without the executable", () => {
    const args = devLauncherArgs(target)
    expect(args[0]).toBe("--experimental-ffi")
    expect(args.at(-1)).toBe(target.entry)
    expect(args.join(" ")).toContain(path.join("script", "solid-loader.mjs"))
  })

  test("only the dev target needs extra environment", () => {
    expect(terminalLaunchEnv(target)).toEqual({
      TSX_TSCONFIG_PATH: path.join(target.cwd, "tsconfig.json"),
    })
    expect(terminalLaunchEnv({ kind: "path" })).toEqual({})
    expect(terminalLaunchEnv({ kind: "binary", command: "/x" })).toEqual({})
  })
})

test("terminal name matches the TUI's OSC title branding", () => {
  expect(TERMINAL_NAME).toBe("AX Code")
})
