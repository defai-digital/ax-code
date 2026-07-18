import { describe, expect, test, vi } from "vitest"
import path from "node:path"
import { prepareNodeArgs } from "./node-ffi-runner-args.mjs"

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
