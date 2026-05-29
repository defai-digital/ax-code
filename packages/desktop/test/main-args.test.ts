import { describe, expect, test } from "bun:test"
import { desktopMainArgs } from "../src/main-args"

describe("desktop main argv normalization", () => {
  test("keeps packaged Electron flags when no script path is present", () => {
    expect(desktopMainArgs(["/Applications/AX Code.app/Contents/MacOS/Electron", "--dry-run"])).toEqual(["--dry-run"])
  })

  test("drops source entrypoint paths for Bun runs", () => {
    expect(
      desktopMainArgs(["/opt/homebrew/bin/bun", "/workspace/ax-code/packages/desktop/src/main.ts", "--dry-run"]),
    ).toEqual(["--dry-run"])
  })

  test("drops Electron app entrypoint paths when present", () => {
    expect(
      desktopMainArgs([
        "/workspace/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
        "/workspace/ax-code/packages/desktop/dist/mac/AX Code.app/Contents/Resources/app",
        "--dry-run",
      ]),
    ).toEqual(["--dry-run"])
  })
})
