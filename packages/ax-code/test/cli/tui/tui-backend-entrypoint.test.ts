import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const PACKAGE_ROOT = path.resolve(import.meta.dir, "../../..")
const WORKER_SRC = readFileSync(path.join(PACKAGE_ROOT, "src/cli/cmd/tui/worker.ts"), "utf8")

describe("tui backend entrypoint guardrails", () => {
  test("does not auto-bind worker transport when imported by the packaged stdio backend command", () => {
    expect(WORKER_SRC).toContain("await startTuiBackend(\"worker\")")
    expect(WORKER_SRC).toContain("if (isWorkerEntrypoint())")
    expect(WORKER_SRC).not.toContain("import.meta.main || isWorkerEntrypoint()")
  })
})
