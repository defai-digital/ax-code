import { execFileSync } from "node:child_process"
import path from "node:path"
import { describe, expect, test } from "vitest"

const root = path.resolve(import.meta.dirname, "..")

describe("release entrypoint", () => {
  test("delegates to the canonical CLI release command", () => {
    const output = execFileSync("bash", [path.join(root, "script/release"), "--help"], {
      cwd: root,
      encoding: "utf8",
    })

    expect(output).toContain("pnpm run publish:github -- [options]")
    expect(output).toContain("--dry-run")
  })
})
