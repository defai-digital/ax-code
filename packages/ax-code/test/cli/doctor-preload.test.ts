import { describe, expect, test } from "bun:test"
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
