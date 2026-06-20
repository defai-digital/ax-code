import { describe, expect, test } from "vitest"
import * as fs from "fs/promises"
import path from "path"
import {
  decodePackageScripts,
  parsePackageScripts,
  resolveCommands,
  runCommand,
} from "../../src/planner/verification/runner"
import { tmpdir } from "../fixture/fixture"

async function writePackageJson(dir: string, scripts: Record<string, string>) {
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test", version: "0.0.0", scripts }, null, 2),
    "utf8",
  )
}

describe("resolveCommands", () => {
  test("decodePackageScripts decodes already-parsed package scripts", () => {
    expect(
      decodePackageScripts({
        scripts: {
          typecheck: "tsc --noEmit",
          lint: 123,
          test: "vitest",
        },
      }),
    ).toEqual({ typecheck: "tsc --noEmit", test: "vitest" })
    expect(decodePackageScripts({ scripts: [] })).toEqual({})
    expect(decodePackageScripts(null)).toEqual({})
  })

  test("parsePackageScripts decodes only string package scripts", () => {
    expect(
      parsePackageScripts(
        JSON.stringify({
          scripts: {
            typecheck: "tsc --noEmit",
            lint: 123,
            test: "vitest",
          },
        }),
      ),
    ).toEqual({ typecheck: "tsc --noEmit", test: "vitest" })

    expect(parsePackageScripts(JSON.stringify({ scripts: [] }))).toEqual({})
    expect(parsePackageScripts(JSON.stringify(null))).toEqual({})
    expect(() => parsePackageScripts("{ not json")).toThrow(SyntaxError)
  })

  test("returns all-null when no package.json exists", async () => {
    await using tmp = await tmpdir({ git: true })
    const cmds = await resolveCommands(tmp.path)
    expect(cmds).toEqual({ typecheck: null, lint: null, test: null })
  })

  test("returns all-null when package.json exists but has no relevant scripts", async () => {
    await using tmp = await tmpdir({ git: true })
    await writePackageJson(tmp.path, { build: "tsc" })
    const cmds = await resolveCommands(tmp.path)
    expect(cmds).toEqual({ typecheck: null, lint: null, test: null })
  })

  test("picks `npm run typecheck` (default PM) when package.json has a typecheck script", async () => {
    await using tmp = await tmpdir({ git: true })
    await writePackageJson(tmp.path, { typecheck: "tsc --noEmit" })
    const cmds = await resolveCommands(tmp.path)
    expect(cmds.typecheck).toBe("npm run typecheck")
    expect(cmds.lint).toBeNull()
    expect(cmds.test).toBeNull()
  })

  test("picks `npm run lint` when package.json has a lint script", async () => {
    await using tmp = await tmpdir({ git: true })
    await writePackageJson(tmp.path, { lint: "eslint ." })
    const cmds = await resolveCommands(tmp.path)
    expect(cmds.lint).toBe("npm run lint")
  })

  test("picks `npm test` when package.json has a test script", async () => {
    await using tmp = await tmpdir({ git: true })
    await writePackageJson(tmp.path, { test: "vitest" })
    const cmds = await resolveCommands(tmp.path)
    expect(cmds.test).toBe("npm test")
  })

  test("detects the project package manager (pnpm lockfile)", async () => {
    await using tmp = await tmpdir({ git: true })
    await writePackageJson(tmp.path, { typecheck: "tsc --noEmit", test: "vitest" })
    await fs.writeFile(path.join(tmp.path, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8")
    const cmds = await resolveCommands(tmp.path)
    expect(cmds.typecheck).toBe("pnpm run typecheck")
    expect(cmds.test).toBe("pnpm test")
  })

  test("override.typecheck=null forces typecheck off even when script exists", async () => {
    await using tmp = await tmpdir({ git: true })
    await writePackageJson(tmp.path, { typecheck: "tsc --noEmit", lint: "eslint" })
    const cmds = await resolveCommands(tmp.path, { typecheck: null })
    expect(cmds.typecheck).toBeNull()
    // lint default still applies
    expect(cmds.lint).toBe("npm run lint")
  })

  test("override with a custom command string is used verbatim", async () => {
    await using tmp = await tmpdir({ git: true })
    await writePackageJson(tmp.path, { typecheck: "tsc" })
    const cmds = await resolveCommands(tmp.path, {
      typecheck: "pnpm exec tsc --strict",
      lint: "pnpm exec eslint --max-warnings 0 .",
      test: "pnpm exec vitest run",
    })
    expect(cmds.typecheck).toBe("pnpm exec tsc --strict")
    expect(cmds.lint).toBe("pnpm exec eslint --max-warnings 0 .")
    expect(cmds.test).toBe("pnpm exec vitest run")
  })

  test("malformed package.json is treated as no scripts (does not throw)", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "package.json"), "{ not json", "utf8")
    const cmds = await resolveCommands(tmp.path)
    expect(cmds).toEqual({ typecheck: null, lint: null, test: null })
  })

  test("non-string package scripts are ignored", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "package.json"),
      JSON.stringify({ scripts: { typecheck: true, lint: "eslint ." } }),
      "utf8",
    )
    const cmds = await resolveCommands(tmp.path)
    expect(cmds.typecheck).toBeNull()
    expect(cmds.lint).toBe("npm run lint")
  })

  test("falls back to cargo commands in a Rust workspace", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "Cargo.toml"), '[package]\nname = "demo"\nversion = "0.1.0"\n')
    const cmds = await resolveCommands(tmp.path)
    expect(cmds).toEqual({
      typecheck: "cargo check",
      lint: "cargo clippy --all-targets --all-features -- -D warnings",
      test: "cargo test",
    })
  })

  test("package scripts take precedence over cargo defaults", async () => {
    await using tmp = await tmpdir({ git: true })
    await writePackageJson(tmp.path, { typecheck: "tsc --noEmit" })
    await fs.writeFile(path.join(tmp.path, "Cargo.toml"), '[package]\nname = "demo"\nversion = "0.1.0"\n')
    const cmds = await resolveCommands(tmp.path)
    expect(cmds.typecheck).toBe("npm run typecheck")
    expect(cmds.lint).toBe("cargo clippy --all-targets --all-features -- -D warnings")
    expect(cmds.test).toBe("cargo test")
  })

  test("override null disables the matching cargo default", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "Cargo.toml"), '[package]\nname = "demo"\nversion = "0.1.0"\n')
    const cmds = await resolveCommands(tmp.path, { lint: null })
    expect(cmds.typecheck).toBe("cargo check")
    expect(cmds.lint).toBeNull()
    expect(cmds.test).toBe("cargo test")
  })

  test("runCommand sanitizes secret-like parent environment variables", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = "secret-from-parent"
    try {
      const result = await runCommand(`node -e "console.log(process.env.OPENAI_API_KEY ?? 'missing')"`, tmp.path)
      expect(result.ok).toBe(true)
      expect(result.stdout.trim()).toBe("missing")
    } finally {
      if (previous === undefined) {
        delete process.env.OPENAI_API_KEY
      } else {
        process.env.OPENAI_API_KEY = previous
      }
    }
  })
})
