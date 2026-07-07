import { describe, expect, test } from "vitest"
import path from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "../fixture/fixture"
import { JsonParseGuard } from "../../script/check-bare-json-parse"

describe("script.check-bare-json-parse", () => {
  test("ignores the implementation file and allowlisted files", async () => {
    await using tmp = await tmpdir()
    await mkdir(path.join(tmp.path, "src/util"), { recursive: true })
    await mkdir(path.join(tmp.path, "src/bun"), { recursive: true })
    await writeFile(path.join(tmp.path, "src/util/json-value.ts"), `export const value = JSON.parse("{}")\n`)
    await writeFile(path.join(tmp.path, "src/bun/node-compat.ts"), `export const value = JSON.parse("{}")\n`)

    expect(await JsonParseGuard.check(tmp.path)).toEqual([])
  })

  test("ignores files already grandfathered in ExistingViolations", async () => {
    await using tmp = await tmpdir()
    for (const file of JsonParseGuard.ExistingViolations) {
      await mkdir(path.join(tmp.path, path.dirname(file)), { recursive: true })
      await writeFile(path.join(tmp.path, file), `export const value = JSON.parse("{}")\n`)
    }

    expect(await JsonParseGuard.check(tmp.path)).toEqual([])
  })

  test("ignores JSON.parse mentioned only in a comment", async () => {
    await using tmp = await tmpdir()
    await mkdir(path.join(tmp.path, "src/account"), { recursive: true })
    await writeFile(
      path.join(tmp.path, "src/account/new.ts"),
      `// callers should not need to call JSON.parse(raw) directly\nexport const value = 1\n`,
    )

    expect(await JsonParseGuard.check(tmp.path)).toEqual([])
  })

  test("flags a bare JSON.parse call in a new file", async () => {
    await using tmp = await tmpdir()
    await mkdir(path.join(tmp.path, "src/account"), { recursive: true })
    await writeFile(
      path.join(tmp.path, "src/account/new.ts"),
      `function decode(raw: string) {\n  return JSON.parse(raw)\n}\n`,
    )

    expect(await JsonParseGuard.check(tmp.path)).toEqual([
      { file: "src/account/new.ts", line: 2, text: "return JSON.parse(raw)" },
    ])
  })

  test("reports allowlist entries that no longer call JSON.parse as stale", async () => {
    await using tmp = await tmpdir()
    for (const file of JsonParseGuard.ExistingViolations) {
      await mkdir(path.join(tmp.path, path.dirname(file)), { recursive: true })
      await writeFile(path.join(tmp.path, file), `export const value = 1\n`)
    }

    expect((await JsonParseGuard.staleAllowlistEntries(tmp.path)).sort()).toEqual(
      [...JsonParseGuard.ExistingViolations].sort(),
    )
  })

  test("reports a missing allowlisted file as stale", async () => {
    await using tmp = await tmpdir()
    expect((await JsonParseGuard.staleAllowlistEntries(tmp.path)).sort()).toEqual(
      [...JsonParseGuard.ExistingViolations].sort(),
    )
  })
})

describe("script.check-bare-json-parse against the real repo", () => {
  const root = path.resolve(import.meta.dirname, "../..")

  test("has no new bare JSON.parse call sites outside the allowlist", async () => {
    expect(await JsonParseGuard.check(root)).toEqual([])
  })
})
