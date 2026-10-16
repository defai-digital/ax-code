import { afterEach, describe, expect, test } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { DebugEngine } from "../src/index"
import { installTestHost, resetTestHost } from "./fixture/host"

const PROJECT_ID = "test-detect-security-line"

describe("detectSecurity line scanning", () => {
  const roots: string[] = []
  afterEach(() => {
    resetTestHost()
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  test("reads the matched path call, not an earlier one on the same line", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ax-reason-security-"))
    roots.push(root)
    // The scanner only reads files the host's project root contains.
    installTestHost({ projectRoot: root })
    // Both lines open with `path.dirname`, so reading from the line's first
    // `path.` hands the literal check the wrong call.
    const safe = path.join(root, "safe.ts")
    const unsafe = path.join(root, "unsafe.ts")
    writeFileSync(safe, `const base = path.dirname(file); const full = path.join("/data", "ok")\n`)
    writeFileSync(unsafe, `const base = path.dirname(file); const full = path.join("/data", name)\n`)
    const report = await DebugEngine.detectSecurity(PROJECT_ID as never, { files: [safe, unsafe] })
    const traversals = report.findings.filter((finding) => finding.pattern === "path_traversal")
    // The control: the variable-argument call on the same line shape is a hit,
    // so the literals-only one below is skipped by the check, not by the scan.
    expect(traversals.map((finding) => finding.file)).toEqual([unsafe])
  })
})
