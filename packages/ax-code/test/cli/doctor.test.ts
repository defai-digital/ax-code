import { afterEach, describe, expect, test } from "vitest"
import { mkdir, writeFile, readFile } from "fs/promises"
import path from "path"
import {
  doctorProjectContext,
  getDuplicateProjectIdentityCheck,
  getIsolationPolicyCheck,
  getPathLauncherCheck,
  getRuntimeCheck,
  getServerExposureCheck,
  isHomebrewManagedPath,
} from "../../src/cli/cmd/doctor"
import { ProjectIdentity } from "../../src/project/project-identity"
import { ProjectTable } from "../../src/project/project.sql"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
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
      detail: "mode workspace-write (default); network disabled (default)",
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
