import { describe, expect, test } from "vitest"
import * as fs from "fs/promises"
import path from "path"
import { typecheck } from "../../src/planner/verification"
import { tmpdir } from "../fixture/fixture"

async function writePackageJson(dir: string, scripts: Record<string, string>) {
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "verification-test", version: "0.0.0", scripts }, null, 2),
    "utf8",
  )
}

describe("planner verification", () => {
  test("skips typecheck when the project has no typecheck command", async () => {
    await using tmp = await tmpdir({ git: true })

    const result = await typecheck(tmp.path)

    expect(result.passed).toBe(true)
    expect(result.status).toBe("skipped")
    expect(result.output).toBe("typecheck command not configured")
  })

  test("runs the detected package typecheck script", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "typecheck.js"), 'process.stdout.write("ok")\n', "utf8")
    await writePackageJson(tmp.path, {
      typecheck: "node typecheck.js",
    })

    const result = await typecheck(tmp.path)

    expect(result.passed).toBe(true)
    expect(result.status).toBe("passed")
    expect(result.output).toContain("ok")
  })

  test("parses TypeScript errors from the configured typecheck script", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "typecheck.js"),
      'process.stderr.write("src/a.ts(3,5): error TS2322: incompatible\\n"); process.exit(1)\n',
      "utf8",
    )
    await writePackageJson(tmp.path, {
      typecheck: "node typecheck.js",
    })

    const result = await typecheck(tmp.path)

    expect(result.passed).toBe(false)
    expect(result.status).toBe("failed")
    expect(result.issues).toEqual([
      {
        file: "src/a.ts",
        line: 3,
        column: 5,
        severity: "error",
        code: "TS2322",
        message: "incompatible",
      },
    ])
  })
})
