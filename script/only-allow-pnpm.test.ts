import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { blockMessage, resolvePnpmEnforcement } from "./only-allow-pnpm.mjs"

describe("pnpm-only script guard", () => {
  test("allows the pnpm user agent that pnpm sets for its scripts", () => {
    expect(resolvePnpmEnforcement("pnpm/10.33.4 npm/? node/v26.9.0 darwin arm64")).toEqual({
      allowed: true,
      used: "pnpm",
    })
  })

  test("blocks npm, yarn, bun, and unknown user agents", () => {
    expect(resolvePnpmEnforcement("npm/11.19.1 node/v26.9.0 darwin arm64 workspaces/false")).toEqual({
      allowed: false,
      used: "npm",
    })
    expect(resolvePnpmEnforcement("yarn/1.22.22 npm/? node/v26.9.0 darwin arm64")).toEqual({
      allowed: false,
      used: "yarn",
    })
    expect(resolvePnpmEnforcement("bun/1.2.0 npm/? node/v26.9.0 darwin arm64")).toEqual({
      allowed: false,
      used: "bun",
    })
    expect(resolvePnpmEnforcement("")).toEqual({ allowed: false, used: undefined })
  })

  test("block message names the detected manager and the pnpm replacements", () => {
    const message = blockMessage("npm")
    expect(message).toContain('run with "npm"')
    expect(message).toContain("pnpm run <script>")
    expect(message).toContain("pnpm install")
  })

  test("every root script npm could invoke is wired to the guard through a pre-hook", () => {
    const manifest = JSON.parse(readFileSync(path.join(import.meta.dirname, "../package.json"), "utf8")) as {
      scripts: Record<string, string>
    }
    const scripts = manifest.scripts
    // Install lifecycle entries are guarded by `preinstall: npx only-allow pnpm`
    // itself; `pre`/`post` entries that shadow an existing script are hooks, not
    // targets.
    const exempt = new Set(["preinstall", "postinstall", "prepare"])
    const isHook = (name: string) =>
      (name.startsWith("pre") && scripts[name.slice(3)] !== undefined) ||
      (name.startsWith("post") && scripts[name.slice(4)] !== undefined)
    const missing = Object.keys(scripts)
      .filter((name) => !exempt.has(name) && !isHook(name))
      .filter((name) => !(scripts[`pre${name}`] ?? "").includes("only-allow-pnpm.mjs"))
    expect(missing).toEqual([])
  })

  test("the CLI entry exits non-zero under npm and silently passes under pnpm", () => {
    const guard = path.join(import.meta.dirname, "only-allow-pnpm.mjs")
    const run = (userAgent: string) =>
      spawnSync(process.execPath, [guard], {
        encoding: "utf8",
        env: { ...process.env, npm_config_user_agent: userAgent },
      })
    const blocked = run("npm/11.19.1 node/v26.9.0 darwin arm64")
    expect(blocked.status).toBe(1)
    expect(blocked.stderr).toContain("[only-allow-pnpm]")
    expect(blocked.stderr).toContain("pnpm run <script>")
    const allowed = run("pnpm/10.33.4 npm/? node/v26.9.0 darwin arm64")
    expect(allowed.status).toBe(0)
    expect(allowed.stdout).toBe("")
    expect(allowed.stderr).toBe("")
  })
})
