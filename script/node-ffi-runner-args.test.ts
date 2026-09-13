import { afterEach, describe, expect, test, vi } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  partitionExecveFlags,
  prepareNodeArgs,
  splitNodeLaunchArgs,
  toNodeOptionsImportSpecifier,
} from "./node-ffi-runner-args.mjs"

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

describe("toNodeOptionsImportSpecifier", () => {
  test("keeps bare package names", () => {
    expect(toNodeOptionsImportSpecifier("tsx")).toBe("tsx")
  })

  test("keeps existing file URLs", () => {
    expect(toNodeOptionsImportSpecifier("file:///repo/script/solid-loader.mjs")).toBe(
      "file:///repo/script/solid-loader.mjs",
    )
  })

  test("converts absolute filesystem paths to file URLs", () => {
    const absolute = path.resolve("/repo/packages/ax-code/src/index-node-tui.ts")
    expect(toNodeOptionsImportSpecifier(absolute)).toBe(pathToFileURL(absolute).href)
  })

  test("converts dotted relative paths to file URLs", () => {
    const cwd = path.resolve("/repo/packages/ax-code")
    expect(toNodeOptionsImportSpecifier("./src/index-node-tui.ts", { cwd, exists: () => false })).toBe(
      pathToFileURL(path.join(cwd, "src/index-node-tui.ts")).href,
    )
    expect(toNodeOptionsImportSpecifier("../../script/solid-loader.mjs", { cwd, exists: () => false })).toBe(
      pathToFileURL(path.resolve(cwd, "../../script/solid-loader.mjs")).href,
    )
  })

  test("converts cwd-relative entries that exist on disk", () => {
    const cwd = path.resolve("/repo/packages/ax-code")
    const entry = "src/index-node-tui.ts"
    expect(toNodeOptionsImportSpecifier(entry, { cwd, exists: (file) => file === path.join(cwd, entry) })).toBe(
      pathToFileURL(path.join(cwd, entry)).href,
    )
  })

  test("rewrites the real source TUI entry so NODE_OPTIONS --import cannot treat src as a package", () => {
    const cwd = path.resolve(import.meta.dirname, "../packages/ax-code")
    const specifier = toNodeOptionsImportSpecifier("src/index-node-tui.ts", { cwd })
    expect(specifier.startsWith("file:")).toBe(true)
    expect(specifier).toContain("index-node-tui.ts")
    expect(specifier).not.toBe("src/index-node-tui.ts")
    expect(new URL(specifier).pathname.endsWith("/packages/ax-code/src/index-node-tui.ts")).toBe(true)
  })

  test("leaves package subpaths that are not files on disk", () => {
    expect(toNodeOptionsImportSpecifier("tsx/esm", { cwd: "/repo", exists: () => false })).toBe("tsx/esm")
  })
})

describe("partitionExecveFlags", () => {
  test("keeps --env-file-if-exists on argv because NODE_OPTIONS forbids it", () => {
    expect(partitionExecveFlags(["--import", "tsx", "--env-file-if-exists=/repo/.env", "--conditions=node"])).toEqual({
      nodeOptionsFlags: ["--import", "tsx", "--conditions=node"],
      argvFlags: ["--env-file-if-exists=/repo/.env"],
    })
  })
})

describe("POSIX runner env-file admission", () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  test.skipIf(process.platform === "win32")("loads --optional-env-file through argv instead of NODE_OPTIONS", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ax-code-runner-env-"))
    roots.push(root)
    writeFileSync(path.join(root, ".env"), "AX_CODE_RUNNER_ENV_PROBE=from-file\n")
    const entry = path.join(root, "entry.mjs")
    writeFileSync(entry, "process.stdout.write(process.env.AX_CODE_RUNNER_ENV_PROBE ?? 'missing')")
    const result = spawnSync(
      process.execPath,
      [path.join(import.meta.dirname, "node-ffi-runner.mjs"), `--optional-env-file=${path.join(root, ".env")}`, entry],
      {
        encoding: "utf8",
        timeout: 20_000,
        env: { ...process.env, XDG_CACHE_HOME: path.join(root, "cache") },
      },
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).not.toContain("not allowed in NODE_OPTIONS")
    expect(result.stdout).toContain("from-file")
  })
})
