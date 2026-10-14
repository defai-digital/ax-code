import { describe, expect, test } from "vitest"
// The harness import configures the package host port; it must stay ahead of
// the src imports below (ES modules evaluate in import order).
import "../harness"
import { LSP } from "../../src/index-impl"
import { serverSupportsFileExtension } from "../../src/selection"

describe("LSP file extension key", () => {
  test("lowercases a mixed-case extension so a server still matches", () => {
    expect(LSP.fileExtensionKey("src/Foo.TS")).toBe(".ts")
    expect(LSP.fileExtensionKey("src/handler.PY")).toBe(".py")
  })

  test("falls back to the basename (as written) for an extensionless file", () => {
    // Server defs list basenames like "Dockerfile"; the workspace probe used the
    // whole path, so an extensionless server could never be matched.
    expect(LSP.fileExtensionKey("/repo/Dockerfile")).toBe("Dockerfile")
    expect(LSP.fileExtensionKey("Makefile")).toBe("Makefile")
  })

  test("the derived key matches the lowercased server extension lists", () => {
    expect(serverSupportsFileExtension({ extensions: [".ts"] }, LSP.fileExtensionKey("Foo.TS"))).toBe(true)
    expect(serverSupportsFileExtension({ extensions: ["Dockerfile"] }, LSP.fileExtensionKey("/repo/Dockerfile"))).toBe(
      true,
    )
  })
})
