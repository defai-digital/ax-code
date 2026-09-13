import { describe, expect, test, vi } from "vitest"
import path from "node:path"
import { prepareNodeArgs, splitNodeLaunchArgs } from "./node-ffi-runner-args.mjs"

describe("node FFI runner arguments", () => {
  test("omits optional env files that do not exist", () => {
    const exists = vi.fn(() => false)

    expect(
      prepareNodeArgs(["--optional-env-file=../../.env", "--import", "tsx", "src/index.ts"], {
        cwd: "/repo/packages/ax-code",
        exists,
      }),
    ).toEqual(["--import", "tsx", "src/index.ts"])
    expect(exists).toHaveBeenCalledWith(path.resolve("/repo/packages/ax-code", "../../.env"))
  })

  test("keeps optional env files that exist", () => {
    const envFile = path.resolve("/repo/packages/ax-code", "../../.env")

    expect(
      prepareNodeArgs(["--optional-env-file=../../.env", "src/index.ts"], {
        cwd: "/repo/packages/ax-code",
        exists: () => true,
      }),
    ).toEqual([`--env-file-if-exists=${envFile}`, "src/index.ts"])
  })

  test("rejects an empty optional env file path", () => {
    expect(() => prepareNodeArgs(["--optional-env-file="], { exists: () => false })).toThrow(
      "--optional-env-file requires a path",
    )
  })

  test("leaves standard Node env file arguments unchanged", () => {
    const args = ["--env-file=.env", "--env-file-if-exists=.env", "src/index.ts"]

    expect(prepareNodeArgs(args, { exists: () => false })).toEqual(args)
  })
})

describe("splitNodeLaunchArgs", () => {
  test("splits leading Node flags, the entry, and user args", () => {
    expect(
      splitNodeLaunchArgs([
        "--import",
        "tsx",
        "--import",
        "/repo/script/solid-loader.mjs",
        "--conditions=node",
        "/repo/packages/ax-code/src/index-node-tui.ts",
        "--session",
        "abc",
      ]),
    ).toEqual({
      nodeFlags: ["--import", "tsx", "--import", "/repo/script/solid-loader.mjs", "--conditions=node"],
      entry: "/repo/packages/ax-code/src/index-node-tui.ts",
      userArgs: ["--session", "abc"],
    })
  })

  test("treats flags with an inline value as single tokens", () => {
    expect(splitNodeLaunchArgs(["--conditions=node", "/repo/lib/index-node-tui.js"])).toEqual({
      nodeFlags: ["--conditions=node"],
      entry: "/repo/lib/index-node-tui.js",
      userArgs: [],
    })
  })

  test("handles a missing entry and no arguments", () => {
    expect(splitNodeLaunchArgs([])).toEqual({ nodeFlags: [], entry: undefined, userArgs: [] })
  })
})
