import { describe, expect, test } from "vitest"
import { getTuiPreloadCheck } from "../../src/cli/cmd/doctor-preload"

describe("doctor TUI preload checks", () => {
  test("treats bundled runtimes as self-contained", () => {
    const check = getTuiPreloadCheck({
      bundled: true,
      resolveSync: () => {
        throw new Error("bundled runtimes should not resolve preload from disk")
      },
    })

    expect(check).toEqual({
      name: "TUI preload",
      status: "ok",
      detail: "Bundled runtime — OpenTUI JSX is transformed at build time",
    })
  })

  test("reports resolved preload path for source runtimes", () => {
    const check = getTuiPreloadCheck({
      bundled: false,
      importMetaDir: "/repo/packages/ax-code/src/cli/cmd",
      resolveSync: () => "/repo/node_modules/@opentui/solid/preload.ts",
    })

    expect(check).toEqual({
      name: "TUI preload",
      status: "ok",
      detail: "@opentui/solid/preload resolved (solid)",
    })
  })

  test("reports Node bundled runtime with node:ffi as TUI-ready", () => {
    const check = getTuiPreloadCheck({
      runtimeMode: "node-bundled",
      ffiAvailable: true,
      resolveSync: () => {
        throw new Error("node bundled runtime should not resolve preload from disk")
      },
    })

    expect(check).toEqual({
      name: "TUI preload",
      status: "ok",
      detail: "Node runtime — OpenTUI renders via node:ffi; JSX transformed at build time",
    })
  })

  test("warns Node bundled runtime without node:ffi (no --experimental-ffi)", () => {
    const check = getTuiPreloadCheck({
      runtimeMode: "node-bundled",
      ffiAvailable: false,
      resolveSync: () => {
        throw new Error("node bundled runtime should not resolve preload from disk")
      },
    })

    expect(check).toEqual({
      name: "TUI preload",
      status: "warn",
      detail:
        "Node runtime without node:ffi — run node with --experimental-ffi for the interactive TUI (diagnostic/headless otherwise)",
    })
  })

  test("fails source runtimes when preload is missing", () => {
    const check = getTuiPreloadCheck({
      bundled: false,
      resolveSync: () => {
        throw new Error("module not found")
      },
    })

    expect(check).toEqual({
      name: "TUI preload",
      status: "fail",
      detail: "@opentui/solid/preload not found — source/dev TUI may fail to start. Run: pnpm install",
    })
  })
})
