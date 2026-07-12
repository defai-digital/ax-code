import path from "node:path"
import { describe, expect, test } from "vitest"
import {
  DESKTOP_BOUNDARY_REASONS,
  analyzeDesktopManifest,
  analyzeDesktopSource,
  collectDesktopBoundaryViolations,
} from "./check-desktop-boundaries"

const root = path.resolve(import.meta.dirname, "..")
const webSource = path.join(root, "desktop/packages/web/src/fixture.ts")
const webServer = path.join(root, "desktop/packages/web/server/fixture.js")
const uiSource = path.join(root, "desktop/packages/ui/src/fixture.ts")

function reasons(file: string, source: string) {
  return analyzeDesktopSource(file, source).map((item) => item.reason)
}

describe("Desktop source boundaries", () => {
  test("allows documented UI and SDK entrypoints", () => {
    const source = [
      'import "@openchamber/ui/main"',
      'export type { RuntimeAPIs } from "@openchamber/ui/api/types"',
      'const app = import("@openchamber/ui/apps/renderElectronMiniChatApp")',
      'import { createClient } from "@ax-code/sdk/v2"',
    ].join("\n")

    expect(analyzeDesktopSource(webSource, source)).toEqual([])
  })

  test("blocks package-style and relative imports of private runtime modules", () => {
    const source = [
      'import "ax-code/session/private"',
      'export { provider } from "../../../../packages/ax-code/src/provider/private"',
    ].join("\n")

    expect(reasons(webServer, source)).toEqual([
      DESKTOP_BOUNDARY_REASONS.privateRuntime,
      DESKTOP_BOUNDARY_REASONS.privateRuntime,
    ])
  })

  test("blocks SDK internals while ignoring import-like comments and strings", () => {
    const source = [
      '// import "@ax-code/sdk/dist/comment-only"',
      'const example = "require(\\\"@ax-code/sdk/src/string-only\\\")"',
      'const sdk = require("@ax-code/sdk/dist/v2/index.js")',
    ].join("\n")

    const violations = analyzeDesktopSource(webServer, source)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      line: 3,
      specifier: "@ax-code/sdk/dist/v2/index.js",
      reason: DESKTOP_BOUNDARY_REASONS.sdkInternals,
    })
  })

  test("blocks private UI entrypoints, the cross-package web alias, and sibling source paths", () => {
    const source = [
      'import "@openchamber/ui/private/store"',
      'import "@/private/store"',
      'import "../../ui/src/private/store"',
    ].join("\n")

    expect(reasons(webSource, source)).toEqual([
      DESKTOP_BOUNDARY_REASONS.privateUi,
      DESKTOP_BOUNDARY_REASONS.webUiAlias,
      DESKTOP_BOUNDARY_REASONS.siblingSource,
    ])
  })

  test("allows the UI package to use its own local alias", () => {
    expect(analyzeDesktopSource(uiSource, 'import "@/lib/http"')).toEqual([])
  })
})

describe("Desktop manifest boundaries", () => {
  test("blocks server and shell dependencies in every UI dependency section", () => {
    const manifest = JSON.stringify(
      {
        dependencies: { react: "1.0.0", express: "1.0.0" },
        optionalDependencies: { electron: "1.0.0" },
      },
      null,
      2,
    )
    const file = path.join(root, "desktop/packages/ui/package.json")

    expect(analyzeDesktopManifest(file, manifest).map((item) => item.specifier)).toEqual(["express", "electron"])
  })
})

test("the current Desktop tree satisfies the authoritative boundary policy", async () => {
  expect(await collectDesktopBoundaryViolations()).toEqual([])
})
