import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const packageJsonPath = path.resolve(import.meta.dir, "../../package.json")
const ciWorkflowPath = path.join(repoRoot, ".github/workflows/ax-code-ci.yml")
const tuiRendererWorkflowPath = path.join(repoRoot, ".github/workflows/ax-code-tui-renderer.yml")

describe("source-bundle package.json scripts", () => {
  test("bundle:source script exists and points at build-source.ts", async () => {
    const pkg = JSON.parse(await Bun.file(packageJsonPath).text())
    expect(pkg.scripts["bundle:source"]).toBeDefined()
    expect(pkg.scripts["bundle:source"]).toContain("script/build-source.ts")
  })

  test("bundle:source:smoke runs build then verifies --version", async () => {
    const pkg = JSON.parse(await Bun.file(packageJsonPath).text())
    expect(pkg.scripts["bundle:source:smoke"]).toBeDefined()
    expect(pkg.scripts["bundle:source:smoke"]).toContain("build-source.ts")
    expect(pkg.scripts["bundle:source:smoke"]).toContain("--version")
    expect(pkg.scripts["bundle:source:smoke"]).toContain("dist-source/bundle/index.js")
  })

  test("bundle:source:pack uses dry-run mode (does not actually publish)", async () => {
    // Critical safety check: bundle:source:pack must NEVER trigger an
    // actual npm publish. Contributors run this locally; without
    // AX_CODE_DRY_RUN=1 it would prompt for npm credentials at best
    // and accidentally publish at worst.
    const pkg = JSON.parse(await Bun.file(packageJsonPath).text())
    expect(pkg.scripts["bundle:source:pack"]).toBeDefined()
    expect(pkg.scripts["bundle:source:pack"]).toContain("AX_CODE_DRY_RUN=1")
    expect(pkg.scripts["bundle:source:pack"]).toContain("publish-source.ts")
  })

  test("bundle:source:install-smoke verifies the installed package path", async () => {
    const pkg = JSON.parse(await Bun.file(packageJsonPath).text())
    expect(pkg.scripts["bundle:source:install-smoke"]).toBeDefined()
    expect(pkg.scripts["bundle:source:install-smoke"]).toContain("script/source-install-smoke.ts")
  })

  test("bundle:source:tui-smoke verifies installed OpenTUI startup explicitly", async () => {
    const pkg = JSON.parse(await Bun.file(packageJsonPath).text())
    expect(pkg.scripts["bundle:source:tui-smoke"]).toBeDefined()
    expect(pkg.scripts["bundle:source:tui-smoke"]).toContain("script/source-install-smoke.ts")
    expect(pkg.scripts["bundle:source:tui-smoke"]).toContain("--tui-startup-smoke")

    const installSmokeScript = await Bun.file(
      path.resolve(import.meta.dir, "../../script/source-install-smoke.ts"),
    ).text()
    expect(installSmokeScript).toContain("runTuiStartupSmoke")
    expect(installSmokeScript).toContain('backendTransport: "worker"')
    expect(installSmokeScript).toContain("AX_CODE_INSTALL_SMOKE_TEMP_ROOT")

    const tuiSmokeScript = await Bun.file(path.resolve(import.meta.dir, "../../script/tui-startup-smoke.ts")).text()
    expect(tuiSmokeScript).toContain("bun-pty")
    expect(tuiSmokeScript).toContain("AX_CODE_TUI_STARTUP_SMOKE_TIMEOUT_MS")
    expect(tuiSmokeScript).toContain("AX_CODE_INSTALL_SMOKE_TUI_TIMEOUT_MS")
    expect(tuiSmokeScript).toContain("AX_CODE_TUI_WORKER_READY_TIMEOUT_MS")
    expect(tuiSmokeScript).toContain("tui.startup.appMounted")
    expect(tuiSmokeScript).toContain("pty.kill()")
    expect(tuiSmokeScript).toContain("terminatePtyProcessTree")
    expect(tuiSmokeScript).toContain("process.kill(-pid")
  })

  test("tui:startup-smoke exposes a reusable installed-binary OpenTUI gate", async () => {
    const pkg = JSON.parse(await Bun.file(packageJsonPath).text())
    expect(pkg.scripts["tui:startup-smoke"]).toBeDefined()
    expect(pkg.scripts["tui:startup-smoke"]).toContain("script/tui-startup-smoke.ts")

    const tuiSmokeScript = await Bun.file(path.resolve(import.meta.dir, "../../script/tui-startup-smoke.ts")).text()
    expect(tuiSmokeScript).toContain("function resolveCommand")
    expect(tuiSmokeScript).toContain("path.resolve(command)")
  })

  test("script files referenced by package.json all exist", async () => {
    // Catches typos in script paths before they hit CI.
    const pkg = JSON.parse(await Bun.file(packageJsonPath).text())
    const scripts = pkg.scripts as Record<string, string>
    const referencedFiles = [
      ...new Set(
        Object.values(scripts).flatMap((s) => {
          const matches = s.match(/script\/[a-zA-Z0-9_.-]+\.ts/g) ?? []
          return matches
        }),
      ),
    ]
    for (const rel of referencedFiles) {
      const abs = path.resolve(import.meta.dir, "../..", rel)
      expect(fs.existsSync(abs), `${rel} does not exist`).toBe(true)
    }
  })
})

describe("PR CI bundle-source job", () => {
  test("ax-code-ci.yml has a bundle-source job", async () => {
    const text = await Bun.file(ciWorkflowPath).text()
    expect(text).toContain("bundle-source:")
  })

  test("bundle-source job runs bundle:source script (catches build regressions)", async () => {
    const text = await Bun.file(ciWorkflowPath).text()
    const jobMatch = text.match(/bundle-source:[\s\S]*?(?=\n  \w+:|$)/)
    expect(jobMatch).not.toBeNull()
    expect(jobMatch![0]).toContain("bundle:source")
  })

  test("bundle-source job asserts runtimeMode is bun-bundled or source", async () => {
    // Without this assertion the smoke would pass even if runtimeMode
    // detection silently broke and reported "compiled" or "unknown".
    const text = await Bun.file(ciWorkflowPath).text()
    const jobMatch = text.match(/bundle-source:[\s\S]*?(?=\n  \w+:|$)/)
    expect(jobMatch).not.toBeNull()
    expect(jobMatch![0]).toMatch(/bun-bundled\|source|source\|bun-bundled/)
  })

  test("bundle-source job smokes the bundled tui-backend stdio handshake", async () => {
    const text = await Bun.file(ciWorkflowPath).text()
    const jobMatch = text.match(/bundle-source:[\s\S]*?(?=\n  \w+:|$)/)
    expect(jobMatch).not.toBeNull()
    expect(jobMatch![0]).toContain("tui-backend --stdio")
    expect(jobMatch![0]).toContain('"type":"rpc.request"')
    expect(jobMatch![0]).toContain('"type":"rpc.result"')
  })

  test("bundle-source job uses AX_CODE_DRY_RUN=1 for the pack step (no accidental publish)", async () => {
    const text = await Bun.file(ciWorkflowPath).text()
    const jobMatch = text.match(/bundle-source:[\s\S]*?(?=\n  \w+:|$)/)
    expect(jobMatch).not.toBeNull()
    expect(jobMatch![0]).toContain("AX_CODE_DRY_RUN")
  })

  test("bundle-source job runs on PRs (not just dev branch pushes)", async () => {
    // The whole point is to catch regressions before merge. A regression
    // would still hit dev if the PR check didn't run.
    const text = await Bun.file(ciWorkflowPath).text()
    expect(text).toContain("pull_request:")
  })
})

describe("manual TUI renderer workflow", () => {
  test("uses the maintained source package TUI smoke, not a stale renderer script", async () => {
    const text = await Bun.file(tuiRendererWorkflowPath).text()
    expect(text).toContain("source-install-smoke.ts")
    expect(text).toContain("--tui-startup-smoke")
    expect(text).toContain("AX_CODE_INSTALL_SMOKE_TUI_TIMEOUT_MS")
    expect(text).toContain("AX_CODE_INSTALL_SMOKE_TEMP_ROOT")
    expect(text).not.toContain("tui:renderer:evaluate")
  })
})
