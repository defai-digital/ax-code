import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Ripgrep } from "../../src/file/ripgrep"

describe("file.ripgrep", () => {
  test("parseJsonLine decodes ripgrep JSON records", () => {
    expect(
      Ripgrep.parseJsonLine(
        JSON.stringify({
          type: "match",
          data: {
            path: { text: "src/index.ts" },
            lines: { text: "const needle = true\n" },
            line_number: 1,
            absolute_offset: 0,
            submatches: [
              {
                match: { text: "needle" },
                start: 6,
                end: 12,
              },
            ],
          },
        }),
      ),
    ).toMatchObject({
      type: "match",
      data: {
        path: { text: "src/index.ts" },
        line_number: 1,
      },
    })
  })

  test("parseJsonLine rejects malformed ripgrep JSON records", () => {
    expect(Ripgrep.parseJsonLine("{not json")).toBeUndefined()
    expect(Ripgrep.parseJsonLine(JSON.stringify({ type: "match", data: {} }))).toBeUndefined()
  })

  test("defaults to include hidden", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "visible.txt"), "hello")
        await fs.mkdir(path.join(dir, ".ax-code"), { recursive: true })
        await Bun.write(path.join(dir, ".ax-code", "thing.json"), "{}")
      },
    })

    const files = await Array.fromAsync(Ripgrep.files({ cwd: tmp.path }))
    const hasVisible = files.includes("visible.txt")
    const hasHidden = files.includes(path.join(".ax-code", "thing.json"))
    expect(hasVisible).toBe(true)
    expect(hasHidden).toBe(true)
  })

  test("hidden false excludes hidden", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "visible.txt"), "hello")
        await fs.mkdir(path.join(dir, ".ax-code"), { recursive: true })
        await Bun.write(path.join(dir, ".ax-code", "thing.json"), "{}")
      },
    })

    const files = await Array.fromAsync(Ripgrep.files({ cwd: tmp.path, hidden: false }))
    const hasVisible = files.includes("visible.txt")
    const hasHidden = files.includes(path.join(".ax-code", "thing.json"))
    expect(hasVisible).toBe(true)
    expect(hasHidden).toBe(false)
  })

  test("search returns empty when nothing matches", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "match.ts"), "const value = 'other'\n")
      },
    })

    const hits = await Ripgrep.search({
      cwd: tmp.path,
      pattern: "needle",
    })

    expect(hits).toEqual([])
  })
})
