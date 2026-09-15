import path from "node:path"
import fs from "node:fs/promises"
import { tmpdir } from "../fixture/fixture"
import { expect, test } from "vitest"
import { goalSourceScope } from "../../src/session/goal-source-scope"

const cwd = path.resolve("scope-fixture")
const absolute = (file: string) => path.join(cwd, file)
const message = (metadata: unknown, created = 20, tool = "edit", status = "completed") => ({
  info: { role: "assistant", time: { created } },
  parts: [{ type: "tool", tool, state: { status, metadata } }],
})

test("includes actual edited paths, including both sides of a move, without broadening prefix siblings", () => {
  const result = goalSourceScope({
    cwd,
    created: 10,
    sourcePaths: ["src/ui"],
    messages: [
      message({ filediff: { file: absolute("src/ui/button.ts") } }),
      message({ filediff: { file: absolute("src/ui-extra/train.ts") } }),
      message({ filepath: absolute("test/train.test.ts") }, 20, "write"),
      message({ files: [{ filePath: absolute("old.ts"), movePath: absolute("new.ts") }] }, 20, "apply_patch"),
    ],
  })
  expect(result.additional).toEqual(["new.ts", "old.ts", "src/ui-extra/train.ts", "test/train.test.ts"])
  expect(result.paths).toContain("src/ui")
  expect(result.paths).not.toContain("src/ui/button.ts")
})

test("does not attribute historical, failed, read-only, relative, or goal-control paths to source", () => {
  const result = goalSourceScope({
    cwd,
    created: 10,
    sourcePaths: ["src"],
    messages: [
      message({ filepath: absolute("historical.ts") }, 9),
      message({ filepath: absolute("failed.ts") }, 20, "edit", "error"),
      message({ filepath: absolute("read.ts") }, 20, "read"),
      message({ filepath: "ambiguous-relative.ts" }),
      message({ filepath: absolute(".ax-code/goals/session/plan.md") }),
    ],
  })
  expect(result).toEqual({ paths: ["src"], additional: [], external: [] })
})

test("excludes external scratch files from workspace freshness and reports the boundary", () => {
  const result = goalSourceScope({
    cwd,
    created: 10,
    sourcePaths: ["src"],
    messages: [message({ filepath: path.resolve(cwd, "../outside.ts") })],
  })
  expect(result.paths).toEqual(["src"])
  expect(result.external).toEqual([path.resolve(cwd, "../outside.ts")])
})

test("includes a file tool completed after goal creation within an earlier message", () => {
  const result = goalSourceScope({
    cwd,
    created: 10,
    sourcePaths: ["src"],
    messages: [
      {
        info: { role: "assistant", time: { created: 5 } },
        parts: [
          {
            type: "tool",
            tool: "edit",
            state: {
              status: "completed",
              time: { start: 11, end: 12 },
              metadata: { filediff: { file: absolute("test/new.test.ts") } },
            },
          },
        ],
      },
    ],
  })
  expect(result.additional).toEqual(["test/new.test.ts"])
})

test("maps canonical and aliased workspace paths including deleted files", async () => {
  await using tmp = await tmpdir()
  const real = path.join(tmp.path, "real")
  const alias = path.join(tmp.path, "alias")
  await fs.mkdir(real)
  await fs.symlink(real, alias, process.platform === "win32" ? "junction" : "dir")
  const result = goalSourceScope({
    cwd: alias,
    created: 10,
    sourcePaths: ["src"],
    messages: [message({ filepath: path.join(real, "deleted.ts") }, 20, "write")],
  })
  expect(result.additional).toEqual(["deleted.ts"])
  expect(result.external).toEqual([])
})
