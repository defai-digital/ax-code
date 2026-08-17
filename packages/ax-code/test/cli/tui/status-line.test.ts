import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { runStatusLineCommand, statusLineShellCommand } from "../../../src/cli/cmd/tui/util/status-line"
import { tmpdir } from "../../fixture/fixture"

describe("statusLineShellCommand", () => {
  test("uses cmd /d /s /c on win32 (stock Windows has no sh)", () => {
    expect(statusLineShellCommand("echo hi", "win32")).toEqual(["cmd", ["/d", "/s", "/c", "echo hi"]])
  })

  test("uses sh -c on other platforms", () => {
    expect(statusLineShellCommand("echo hi", "darwin")).toEqual(["sh", ["-c", "echo hi"]])
    expect(statusLineShellCommand("echo hi", "linux")).toEqual(["sh", ["-c", "echo hi"]])
  })
})

describe("runStatusLineCommand", () => {
  test("returns only the first stdout line", async () => {
    const result = await runStatusLineCommand("printf 'first\\nsecond\\n'", {})
    expect(result).toBe("first")
  })

  test("feeds the snapshot as JSON on stdin", async () => {
    const snapshot = { model: "provider/model", cwd: "/tmp", sessionID: "ses_1", version: "0.0.0" }
    const result = await runStatusLineCommand("cat", snapshot)
    expect(result).toBe(JSON.stringify(snapshot))
  })

  test("runs from the configured project directory", async () => {
    await using tmp = await tmpdir()
    const command = process.platform === "win32" ? "cd" : "pwd"
    const result = await runStatusLineCommand(command, {}, { cwd: tmp.path })
    expect(result).toBeDefined()
    expect(await fs.realpath(result!)).toBe(await fs.realpath(tmp.path))
  })

  test("replaces control characters with spaces and trims", async () => {
    const result = await runStatusLineCommand("printf '  a\\tb\x1b[31mc\\r'", {})
    expect(result).toBe("a b [31mc")
  })

  test("flattens C1 control characters (UTF-8 encoded CSI) to spaces", async () => {
    // \302\233 is the UTF-8 encoding of U+009B (CSI) — UTF-8 terminals honor
    // it as a control code, so it must be sanitized like ESC.
    const result = await runStatusLineCommand("printf '\\302\\23331mred\\302\\2330m'", {})
    expect(result).toBe("31mred 0m")
  })

  test("resolves to undefined on empty or whitespace-only output", async () => {
    expect(await runStatusLineCommand("true", {})).toBeUndefined()
    expect(await runStatusLineCommand("printf '\\n  \\n'", {})).toBeUndefined()
  })

  test("resolves to undefined when the command hangs past the timeout", async () => {
    const start = Date.now()
    const result = await runStatusLineCommand("sleep 5", {}, { timeoutMs: 100 })
    expect(result).toBeUndefined()
    expect(Date.now() - start).toBeLessThan(2_000)
  })

  test("truncates output beyond the byte cap", async () => {
    const result = await runStatusLineCommand("printf 'aaaaaaaaaabbbbbbbbbbcccccccccc'", {}, { maxBytes: 5 })
    expect(result).toBe("aaaaa")
  })

  test("resolves to undefined for a nonexistent command", async () => {
    const result = await runStatusLineCommand("definitely-not-a-real-ax-code-command", {})
    expect(result).toBeUndefined()
  })
})

// Regression lock: an in-flight status-line command outlives the interval
// cleanup (unmount / effect re-run on model, agent, or session switch), and
// its late result used to overwrite the current session's line. The prompt
// effect must drop results from cancelled runs.
describe("status line prompt wiring", () => {
  test("prompt effect discards late results from cancelled runs", async () => {
    const prompt = await fs.readFile(
      path.resolve(import.meta.dirname, "../../../src/cli/cmd/tui/component/prompt/index.tsx"),
      "utf8",
    )
    const interval = prompt.indexOf('name: "prompt-status-line"')
    expect(interval).toBeGreaterThan(-1)
    const effect = prompt.slice(Math.max(0, interval - 2_000), interval + 2_000)
    expect(effect).toContain("if (stale) return")
    expect(effect).toContain("stale = true")
    expect(effect).toContain("onCleanup(")
  })
})
