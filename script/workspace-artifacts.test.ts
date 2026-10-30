import { spawnSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { describe, expect, test } from "vitest"

describe("workspace runtime artifacts", () => {
  test("AX TUI widget distributions survive a clean Git checkout", () => {
    const files = ["spinner", "chart"].flatMap((widget) => {
      const directory = `packages/ax-tui/${widget}/dist`
      const entries = readdirSync(directory)
      expect(entries).toContain("index.js")
      expect(entries).toContain("solid.js")
      return entries.map((entry) => `${directory}/${entry}`)
    })
    // --no-index also catches ignore regressions after the artifacts are tracked.
    const result = spawnSync("git", ["check-ignore", "--no-index", "--stdin"], {
      input: files.join("\n") + "\n",
      encoding: "utf8",
    })
    expect(result.error).toBeUndefined()
    expect(result.stderr).toBe("")
    expect(result.stdout).toBe("")
    expect(result.status).toBe(1)
  })
})
