import { afterEach, describe, expect, test, vi } from "vitest"
import { mkdir, writeFile, readFile } from "fs/promises"
import path from "path"
import {
  DOCTOR_CHECK_IDS,
  doctorProjectContext,
  executeDoctor,
  formatNativeFlag,
  getDuplicateProjectIdentityCheck,
  getFeatureFlagsCheck,
  getIsolationPolicyCheck,
  getNativeAddonsCheck,
  getPathLauncherCheck,
  getRuntimeCheck,
  getEvidenceCacheCheck,
  getServerExposureCheck,
  isHomebrewManagedPath,
  renderDoctorHuman,
  toDoctorReport,
  type DoctorCheckEntry,
} from "../../src/cli/cmd/doctor"
import { Installation } from "../../src/installation"
import { ProjectIdentity } from "../../src/project/project-identity"
import { ProjectTable } from "../../src/project/project.sql"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
  vi.unstubAllEnvs()
})

describe("cli doctor PATH launchers", () => {
  test("detects Homebrew binaries via their Cellar realpath", () => {
    expect(
      isHomebrewManagedPath("/opt/homebrew/bin/ax-code", () => "/opt/homebrew/Cellar/ax-code/7.7.1/bin/ax-code"),
    ).toBe(true)
    expect(isHomebrewManagedPath("/Users/dev/.local/bin/ax-code", (p) => p)).toBe(false)
  })

  test("does not warn when a single launcher is on PATH", async () => {
    const check = await getPathLauncherCheck({
      whichAll: () => ["/opt/homebrew/bin/ax-code"],
      versionOf: async () => "7.7.1",
      isHomebrew: () => true,
    })
    expect(check).toBeUndefined()
  })

  test("does not warn when every PATH launcher reports the same version and none is Homebrew", async () => {
    const check = await getPathLauncherCheck({
      whichAll: () => ["/Users/dev/.local/bin/ax-code", "/Users/dev/bin/ax-code"],
      versionOf: async () => "7.7.1",
      isHomebrew: () => false,
    })
    expect(check).toBeUndefined()
  })

  test("warns when a checkout launcher shadows a newer Homebrew install", async () => {
    const check = await getPathLauncherCheck({
      whichAll: () => ["/Users/dev/.local/bin/ax-code", "/opt/homebrew/bin/ax-code"],
      versionOf: async (bin) => (bin.includes("homebrew") ? "7.7.1" : "7.7.0"),
      isHomebrew: (bin) => bin.includes("homebrew"),
    })
    expect(check).toMatchObject({
      name: "PATH launchers",
      status: "warn",
    })
    expect(check?.detail).toContain("/Users/dev/.local/bin/ax-code (v7.7.0)")
    expect(check?.detail).toContain("/opt/homebrew/bin/ax-code (v7.7.1) [Homebrew]")
    expect(check?.detail).toContain("brew upgrade ax-code")
    expect(check?.detail).toContain("mv /Users/dev/.local/bin/ax-code /Users/dev/.local/bin/ax-code.bak")
  })
})

describe("cli doctor native flag formatting", () => {
  test("annotates enabled flags whose native addon failed to load", () => {
    expect(formatNativeFlag("NATIVE_FS", true)).toBe("NATIVE_FS=on")
    expect(formatNativeFlag("NATIVE_FS", false)).toBe("NATIVE_FS=on (addon missing — using TS fallback)")
  })

  test("warns when some native addons fall back to TypeScript", () => {
    const check = getNativeAddonsCheck(new Map([["fs", true]]))
    expect(check.status).toBe("warn")
    expect(check.detail).toContain("1/4 installed (fs)")
    expect(check.detail).toContain("missing index-core, diff, parser")
    expect(check.detail).toContain("TypeScript fallbacks")
  })

  test("is ok only when every native addon loaded", () => {
    const check = getNativeAddonsCheck(
      new Map([
        ["index-core", true],
        ["fs", true],
        ["diff", true],
        ["parser", true],
      ]),
    )
    expect(check.status).toBe("ok")
    expect(check.detail).toContain("4/4 installed")
  })

  test("warns feature flags that mention a missing addon", () => {
    const check = getFeatureFlagsCheck(["NATIVE_FS=on", "NATIVE_INDEX=on (addon missing — using TS fallback)"])
    expect(check?.status).toBe("warn")
    expect(check?.detail).toContain("addon missing")
  })
})

test("doctor distinguishes evidence cache capability from project ownership", () => {
  expect(getEvidenceCacheCheck("rocksdb", true)).toMatchObject({ status: "ok" })
  expect(getEvidenceCacheCheck("rocksdb", true).detail).toContain("Project lock or I/O failures")
  expect(getEvidenceCacheCheck("rocksdb", false)).toMatchObject({ status: "warn" })
  expect(getEvidenceCacheCheck("rocksdb", false).detail).toContain("memory fallback")
  expect(getEvidenceCacheCheck("memory", false).detail).toBe("Memory only")
  expect(getEvidenceCacheCheck("off", true).detail).toBe("Disabled (off)")
})

test.each([undefined, ""])("doctor reports memory by default for %s", (value) => {
  vi.stubEnv("AX_CODE_EVIDENCE_CACHE", value)
  expect(getEvidenceCacheCheck()).toMatchObject({ status: "ok", detail: "Memory only" })
})

describe("cli doctor runtime check", () => {
  test("names the engine by the actual runtime, not the packaging mode", () => {
    const check = getRuntimeCheck()
    expect(check.name).toBe("Runtime")
    // The suite runs on Node, so `process.versions.bun` is undefined and the
    // check must report Node — regression guard for node-source/source runs
    // being mislabelled "Bun <node-version>" by the Node compat shim.
    expect(process.versions.bun).toBeUndefined()
    expect(check.detail).toMatch(/^Node v\d+/)
    expect(check.detail).not.toContain("Bun")
  })
})

describe("cli doctor", () => {
  test("finds project context when launched from a package subdirectory", async () => {
    await using tmp = await tmpdir()
    const packageDir = path.join(tmp.path, "packages", "ax-code")

    await mkdir(path.join(tmp.path, ".git"), { recursive: true })
    await mkdir(path.join(tmp.path, ".ax-code"), { recursive: true })
    await mkdir(packageDir, { recursive: true })
    await writeFile(path.join(tmp.path, ".git", "HEAD"), "ref: refs/heads/main\n")
    await writeFile(path.join(tmp.path, "AGENTS.md"), "# Project instructions\n")
    await writeFile(path.join(tmp.path, ".ax-code", "ax-code.json"), "{}\n")

    const context = await doctorProjectContext(packageDir)

    expect(context.projectRoot).toBe(tmp.path)
    expect(context.agentsPath).toBe(tmp.path)
    expect(context.configPath).toBe(tmp.path)
  })

  test("warns when one worktree has duplicate project identities", async () => {
    await using tmp = await tmpdir()
    const now = Date.now()

    Database.use((db) => {
      db.insert(ProjectTable)
        .values([
          {
            id: "project-one" as any,
            worktree: tmp.path,
            time_created: now,
            time_updated: now,
            sandboxes: [],
          },
          {
            id: "project-two" as any,
            worktree: tmp.path,
            time_created: now,
            time_updated: now,
            sandboxes: [],
          },
        ])
        .run()
    })

    const duplicates = await ProjectIdentity.listDuplicateWorktreeIdentities({
      worktree: tmp.path,
      currentProjectID: "project-one",
    })
    const check = await getDuplicateProjectIdentityCheck({ worktree: tmp.path })

    expect(duplicates.toSorted((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "project-one", sessionCount: 0, current: true },
      { id: "project-two", sessionCount: 0, current: false },
    ])
    expect(check?.status).toBe("warn")
    expect(check?.detail).toContain("Duplicate project ids")
    expect(check?.detail).toContain("project-one")
    expect(check?.detail).toContain("project-two")
  })

  test("reports server exposure policy from hostname and auth state", () => {
    expect(getServerExposureCheck({ hostname: "127.0.0.1" })).toMatchObject({
      name: "Server exposure",
      status: "ok",
      detail: expect.stringContaining("loopback-only"),
    })

    expect(getServerExposureCheck({ hostname: "0.0.0.0" })).toMatchObject({
      name: "Server exposure",
      status: "ok",
      detail: expect.stringContaining("local-only policy enforced"),
    })

    expect(getServerExposureCheck({ hostname: "0.0.0.0", password: "secret" })).toMatchObject({
      name: "Server exposure",
      status: "ok",
      detail: expect.stringContaining("effective hostname 127.0.0.1"),
    })
  })

  test("reports effective isolation policy and provenance", () => {
    expect(getIsolationPolicyCheck({})).toMatchObject({
      name: "Isolation policy",
      status: "ok",
      detail: "mode full-access (default); network enabled (full-access)",
    })

    expect(getIsolationPolicyCheck({ config: { mode: "workspace-write", network: false } })).toMatchObject({
      name: "Isolation policy",
      status: "ok",
      detail: "mode workspace-write (config); network disabled (config)",
    })

    expect(
      getIsolationPolicyCheck({
        config: { mode: "read-only", network: false },
        envMode: "full-access",
        envNetwork: true,
      }),
    ).toMatchObject({
      name: "Isolation policy",
      status: "ok",
      detail: "mode full-access (env); network enabled (full-access)",
    })
  })

  test("logs configured TUI port fallback failures", async () => {
    const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/doctor.ts"), "utf-8")
    const start = src.indexOf("async function getConfiguredTuiPort()")
    const end = src.indexOf("export async function getDuplicateProjectIdentityCheck", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const block = src.slice(start, end)

    expect(block).not.toContain("catch {}")
    expect(block).toContain('Log.Default.warn("failed to read configured TUI port; falling back to default"')
  })
})

describe("cli doctor machine contract", () => {
  const passing: DoctorCheckEntry = { id: "runtime", name: "Runtime", status: "ok", detail: "Node v22.0.0 (test)" }
  const warning: DoctorCheckEntry = {
    id: "native-addons",
    name: "Native addons",
    status: "warn",
    detail: "None installed — using TypeScript fallbacks",
  }
  const failing: DoctorCheckEntry = {
    id: "config",
    name: "Configuration",
    status: "fail",
    detail: "Could not parse configuration",
  }

  function capture() {
    const io = {
      out: "",
      err: "",
      code: undefined as number | undefined,
    }
    return {
      io,
      deps: {
        stdout: (text: string) => {
          io.out += text
        },
        stderr: (text: string) => {
          io.err += text
        },
        exit: (code: number) => {
          io.code = code
        },
      },
    }
  }

  test("check ids are stable and kebab-case", () => {
    expect(DOCTOR_CHECK_IDS).toEqual([
      "version",
      "path-launchers",
      "runtime",
      "platform",
      "data-dir",
      "config",
      "credentials",
      "agents-md",
      "git",
      "project-identity",
      "server-exposure",
      "isolation-policy",
      "evidence-cache",
      "native-addons",
      "stale-instances",
      "ax-engine",
      "computer-use",
      "tui-server",
      "tui-preload",
      "recent-logs",
      "log-access",
      "tui-log-errors",
      "recent-errors",
      "code-index",
      "tui-engine",
      "legacy-render-flags",
      "feature-flags",
    ])
    for (const id of DOCTOR_CHECK_IDS) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  test("--json emits a parseable document with stable ids", async () => {
    const { io, deps } = capture()
    const code = await executeDoctor({ json: true }, { ...deps, runChecks: async () => [passing, warning, failing] })

    const doc = JSON.parse(io.out)
    expect(doc).toEqual({
      version: Installation.VERSION,
      ok: false,
      checks: [
        { id: "runtime", status: "pass", summary: "Runtime", detail: "Node v22.0.0 (test)" },
        { id: "native-addons", status: "warn", summary: "Native addons", detail: warning.detail },
        { id: "config", status: "fail", summary: "Configuration", detail: failing.detail },
      ],
    })
    expect(code).toBe(1)
    expect(io.code).toBe(1)
  })

  test("a failing check yields exit code 1 in human mode", async () => {
    const { io, deps } = capture()
    const code = await executeDoctor({ json: false }, { ...deps, runChecks: async () => [passing, failing] })

    expect(code).toBe(1)
    expect(io.code).toBe(1)
    expect(io.out).toContain("Runtime: Node v22.0.0 (test)")
    expect(io.out).toContain("1 issue found")
  })

  test("warnings never fail in either mode", async () => {
    const human = capture()
    expect(await executeDoctor({ json: false }, { ...human.deps, runChecks: async () => [warning] })).toBe(0)
    expect(human.io.code).toBeUndefined()
    expect(human.io.out).toContain("1 warning")
    expect(human.io.out).toContain("system is functional")

    const json = capture()
    expect(await executeDoctor({ json: true }, { ...json.deps, runChecks: async () => [warning] })).toBe(0)
    expect(JSON.parse(json.io.out).ok).toBe(true)
  })

  test("--skip filters checks and is forwarded to the runner", async () => {
    const { io, deps } = capture()
    let seen: ReadonlySet<string> = new Set()
    const code = await executeDoctor(
      { json: true, skip: " config ,runtime" },
      {
        ...deps,
        runChecks: async (input) => {
          seen = input.skip
          return [passing, warning, failing].filter((check) => !input.skip.has(check.id))
        },
      },
    )

    expect([...seen].sort()).toEqual(["config", "runtime"])
    const doc = JSON.parse(io.out)
    expect(doc.checks.map((check: { id: string }) => check.id)).toEqual(["native-addons"])
    expect(doc.ok).toBe(true)
    expect(code).toBe(0)
  })

  test("--skip with unknown ids is an error listing valid ids and never runs checks", async () => {
    const { io, deps } = capture()
    let ran = false
    const code = await executeDoctor(
      { json: true, skip: "config,bogus-id" },
      {
        ...deps,
        runChecks: async () => {
          ran = true
          return []
        },
      },
    )

    expect(code).toBe(2)
    expect(io.code).toBe(2)
    expect(ran).toBe(false)
    expect(io.out).toBe("")
    expect(io.err).toContain("unknown --skip id(s): bogus-id")
    for (const id of DOCTOR_CHECK_IDS) expect(io.err).toContain(id)
  })

  test("toDoctorReport marks ok only when no check fails", () => {
    expect(toDoctorReport([passing, warning]).ok).toBe(true)
    expect(toDoctorReport([passing, failing]).ok).toBe(false)
    expect(toDoctorReport([])).toEqual({ version: Installation.VERSION, ok: true, checks: [] })
  })

  test("human rendering keeps the icon and summary wording", () => {
    const text = renderDoctorHuman([passing, warning, failing])
    expect(text).toContain("✓")
    expect(text).toContain("△")
    expect(text).toContain("✗")
    expect(text).toContain("Native addons: None installed — using TypeScript fallbacks")
    expect(text).toContain("1 issue found")
    expect(renderDoctorHuman([passing])).toContain("All checks passed")
  })
})
