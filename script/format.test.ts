import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { getFileInfo } from "prettier"
import { describe, expect, test } from "vitest"

const root = path.resolve(import.meta.dirname, "..")
const ignorePath = path.join(root, ".prettierignore")

describe("generated TUI formatting boundary", () => {
  test.each(["index", "presets", "solid", "utils"])("preserves compiler-owned spinner output: %s", async (name) => {
    for (const extension of ["js", "d.ts"]) {
      const file = path.join(root, "packages/ax-code-tui/spinner/dist", `${name}.${extension}`)
      expect((await getFileInfo(file, { ignorePath })).ignored).toBe(true)
    }
  })

  test("still formats spinner source and application code", async () => {
    for (const file of [
      "packages/ax-code-tui/spinner/src/index.ts",
      "packages/ax-code/src/cli/cmd/tui/ui/dialog-select.tsx",
    ]) {
      expect((await getFileInfo(path.join(root, file), { ignorePath })).ignored).toBe(false)
    }
  })
})

test("formats only explicitly requested paths", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ax-code-format-"))
  try {
    await Promise.all([
      writeFile(path.join(directory, "package.json"), JSON.stringify({ name: "format-fixture", private: true })),
      writeFile(path.join(directory, "selected.ts"), "const selected=1"),
      writeFile(path.join(directory, "untouched.ts"), "const untouched=2"),
      symlink(path.join(root, "node_modules"), path.join(directory, "node_modules"), "junction"),
    ])

    execFileSync("pnpm", ["exec", "tsx", path.join(root, "script/format.ts"), "selected.ts"], {
      cwd: directory,
      encoding: "utf8",
    })

    expect(await readFile(path.join(directory, "selected.ts"), "utf8")).toContain("const selected = 1")
    expect(await readFile(path.join(directory, "untouched.ts"), "utf8")).toBe("const untouched=2")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
