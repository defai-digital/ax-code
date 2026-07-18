import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  resolveBackendImportSpecifier,
  tsxLoaderImportSpecifier,
  tuiBackendTransport,
} from "../../../src/cli/cmd/tui/thread"

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../../..")
const WORKER_SRC = readFileSync(path.join(PACKAGE_ROOT, "src/cli/cmd/tui/worker.ts"), "utf8")

describe("tui backend entrypoint guardrails", () => {
  test("does not auto-bind worker transport when imported by the packaged stdio backend command", () => {
    expect(WORKER_SRC).toContain('await startTuiBackend("worker")')
    expect(WORKER_SRC).toContain("if (isWorkerEntrypoint())")
    expect(WORKER_SRC).not.toContain("import.meta.main || isWorkerEntrypoint()")
  })

  test("worker uses AX Code SDK naming instead of OpenCode aliases", () => {
    expect(WORKER_SRC).toContain("createAxCodeClient")
    expect(WORKER_SRC).not.toContain("createOpencodeClient")
    expect(WORKER_SRC).not.toContain("OpencodeEvent")
  })

  test("uses worker transport only on Bun source runtime", () => {
    expect(tuiBackendTransport({}, { hasBun: false, mode: "node-bundled" })).toBe("process")
    expect(
      tuiBackendTransport({ AX_CODE_TUI_BACKEND_TRANSPORT: "worker" }, { hasBun: false, mode: "node-bundled" }),
    ).toBe("process")
    expect(tuiBackendTransport({ AX_CODE_TUI_BACKEND_TRANSPORT: "worker" }, { hasBun: true, mode: "compiled" })).toBe(
      "process",
    )
    expect(tuiBackendTransport({}, { hasBun: true, mode: "source" })).toBe("worker")
    expect(tuiBackendTransport({ AX_CODE_TUI_BACKEND_TRANSPORT: "process" }, { hasBun: true, mode: "source" })).toBe(
      "process",
    )
  })

  test("uses an absolute tsx loader import for source backend subprocesses", () => {
    const specifier = tsxLoaderImportSpecifier()

    expect(specifier).toMatch(/^file:\/\//)
    expect(specifier).toContain("/tsx/")
    expect(specifier).not.toBe("tsx")
  })

  test("resolves relative backend imports from the parent process startup directory", () => {
    const startupCwd = path.join(path.parse(PACKAGE_ROOT).root, "repo", "packages", "ax-code")

    expect(resolveBackendImportSpecifier("../../script/solid-loader.mjs", startupCwd)).toBe(
      path.join(path.parse(PACKAGE_ROOT).root, "repo", "script", "solid-loader.mjs"),
    )
  })

  test("preserves file URL backend imports", () => {
    const specifier = "file:///repo/script/solid-loader.mjs"

    expect(resolveBackendImportSpecifier(specifier, "/different/cwd")).toBe(specifier)
  })
})
