import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  resolveBackendImportSpecifier,
  tsxLoaderImportSpecifier,
  tuiBackendTransport,
  tuiWorkerReadyTimeoutMs,
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

  test("resolves relative backend imports to file URLs from the parent process startup directory", () => {
    const startupCwd = path.join(path.parse(PACKAGE_ROOT).root, "repo", "packages", "ax-code")
    const resolved = path.join(path.parse(PACKAGE_ROOT).root, "repo", "script", "solid-loader.mjs")

    // `--import` feeds the ESM loader, which rejects bare absolute paths on
    // Windows (ERR_UNSUPPORTED_ESM_URL_SCHEME), so the specifier must be a URL.
    expect(resolveBackendImportSpecifier("../../script/solid-loader.mjs", startupCwd)).toBe(
      pathToFileURL(resolved).href,
    )
  })

  test("preserves file URL backend imports", () => {
    const specifier = "file:///repo/script/solid-loader.mjs"

    expect(resolveBackendImportSpecifier(specifier, "/different/cwd")).toBe(specifier)
  })

  test("gives source runs a larger readiness budget than packaged runtimes", () => {
    // Node + tsx source runs re-transpile the CLI graph inside the backend;
    // packaged runtimes boot in well under a second and keep the tight default.
    expect(tuiWorkerReadyTimeoutMs({}, "node-source")).toBe(90_000)
    expect(tuiWorkerReadyTimeoutMs({}, "node-bundled")).toBe(10_000)
    expect(tuiWorkerReadyTimeoutMs({}, "compiled")).toBe(10_000)
    expect(tuiWorkerReadyTimeoutMs({ AX_CODE_TUI_WORKER_READY_TIMEOUT_MS: "1234" }, "node-source")).toBe(1234)
  })

  test("backend spawn prefers the entry and solid-loader recorded by short-argv launchers", () => {
    const thread = readFileSync(path.join(PACKAGE_ROOT, "src/cli/cmd/tui/thread.ts"), "utf8")

    // POSIX launchers keep argv at "AX-Code /dev/null …", so argv[1] and
    // process.execArgv no longer identify the CLI entry or the solid-loader.
    expect(thread).toContain("Flag.AX_CODE_CLI_ENTRY ?? process.argv[1]")
    expect(thread).toContain("Flag.AX_CODE_CLI_SOLID_LOADER")
  })
})
