import { describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import path from "path"
import { BunProc } from "../src/bun"
import { Global } from "../src/global"
import { PackageRegistry } from "../src/bun/registry"
import { Process } from "../src/util/process"
import { tmpdir } from "./fixture/fixture"

describe("BunProc registry structural guard", () => {
  test("should not contain hardcoded registry parameters", async () => {
    // Read the bun/index.ts file
    const bunIndexPath = path.join(__dirname, "../src/bun/index.ts")
    const content = await fs.readFile(bunIndexPath, "utf-8")

    // Verify that no hardcoded registry is present
    expect(content).not.toContain("--registry=")
    expect(content).not.toContain("hasNpmRcConfig")
    expect(content).not.toContain("NpmRc")
  })

  test("should use Bun's default registry resolution", async () => {
    // Read the bun/index.ts file
    const bunIndexPath = path.join(__dirname, "../src/bun/index.ts")
    const content = await fs.readFile(bunIndexPath, "utf-8")

    // Verify that it uses Bun's default resolution
    expect(content).toContain("Bun's default registry resolution")
    expect(content).toContain("Bun will use them automatically")
    expect(content).toContain("No need to pass --registry flag")
  })

  test("should have correct command structure without registry", async () => {
    // Read the bun/index.ts file
    const bunIndexPath = path.join(__dirname, "../src/bun/index.ts")
    const content = await fs.readFile(bunIndexPath, "utf-8")

    // Extract the install function
    const installFunctionMatch = content.match(/export async function install[\s\S]*?^  }/m)
    expect(installFunctionMatch).toBeTruthy()

    if (installFunctionMatch) {
      const installFunction = installFunctionMatch[0]

      // Verify expected arguments are present
      expect(installFunction).toContain("installArgs(pkg, version)")
      expect(installFunction).toContain("Global.Path.cache")

      // Verify no registry argument is added
      expect(installFunction).not.toContain('"--registry"')
      expect(installFunction).not.toContain('args.push("--registry')
    }
  })
})

describe("BunProc registry behavior", () => {
  test("builds install args without registry flags", () => {
    const args = BunProc.installArgs("foo", "1.2.3", {
      proxied: false,
      ci: false,
      cwd: "/tmp/cache",
    })

    expect(args).toEqual(["add", "--force", "--exact", "--cwd", "/tmp/cache", "foo@1.2.3"])
    expect(args).not.toContain("--registry")
  })

  test("adds no-cache when proxied", () => {
    const args = BunProc.installArgs("foo", "latest", {
      proxied: true,
      ci: false,
      cwd: "/tmp/cache",
    })

    expect(args).toContain("--no-cache")
  })

  test("does not overwrite malformed cache package manifest during install", async () => {
    await using tmp = await tmpdir()
    const originalCache = Global.Path.cache
    const manifest = path.join(tmp.path, "package.json")
    const malformed = "{not json"
    await fs.writeFile(manifest, malformed)

    const run = vi.spyOn(BunProc, "run").mockImplementation(async () => ({
      code: 0,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
    }))

    try {
      ;(Global.Path as { cache: string }).cache = tmp.path
      await expect(BunProc.install("example-plugin", "1.0.0")).rejects.toThrow("Failed to parse JSON")
      expect(run).not.toHaveBeenCalled()
      expect(await fs.readFile(manifest, "utf-8")).toBe(malformed)
    } finally {
      run.mockRestore()
      ;(Global.Path as { cache: string }).cache = originalCache
    }
  })

  test("does not overwrite malformed version check cache", async () => {
    await using tmp = await tmpdir()
    const originalCache = Global.Path.cache
    const pkg = "example-plugin"
    const manifest = path.join(tmp.path, "package.json")
    const versionChecks = path.join(tmp.path, "version-checks.json")
    const malformed = "{not json"

    await fs.mkdir(path.join(tmp.path, "node_modules", pkg), { recursive: true })
    await fs.writeFile(manifest, JSON.stringify({ dependencies: { [pkg]: "1.0.0" } }))
    await fs.writeFile(versionChecks, malformed)

    const outdated = vi.spyOn(PackageRegistry, "isOutdated").mockImplementation(async () => false)
    const run = vi.spyOn(BunProc, "run").mockImplementation(async () => ({
      code: 0,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
    }))

    try {
      ;(Global.Path as { cache: string }).cache = tmp.path
      await expect(BunProc.install(pkg, "latest")).resolves.toBe(path.join(tmp.path, "node_modules", pkg))
      expect(outdated).toHaveBeenCalled()
      expect(run).not.toHaveBeenCalled()
      expect(await fs.readFile(versionChecks, "utf-8")).toBe(malformed)
    } finally {
      run.mockRestore()
      outdated.mockRestore()
      ;(Global.Path as { cache: string }).cache = originalCache
    }
  })
})

describe("BunProc.install range pins (provider SDK compatibility)", () => {
  // Installs run through Process.run regardless of package manager (npm on
  // node runtimes, BunProc.run -> Process.run on bun runtimes), so spying
  // Process.run covers both without touching the real registry.
  const mockInstallRun = () =>
    vi.spyOn(Process, "run").mockResolvedValue({ code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) } as any)

  test("reinstalls when the cached version is outside the requested range (poisoned cache)", async () => {
    await using tmp = await tmpdir()
    const originalCache = Global.Path.cache
    const pkg = "@ai-sdk/anthropic"
    const manifest = path.join(tmp.path, "package.json")
    const modDir = path.join(tmp.path, "node_modules", "@ai-sdk", "anthropic")
    await fs.mkdir(modDir, { recursive: true })
    // Poisoned cache state from the incident: installed via "latest", which
    // resolved to a spec-v4 major the bundled ai major does not accept.
    await fs.writeFile(manifest, JSON.stringify({ dependencies: { [pkg]: "4.0.39" } }))
    // Simulate the package manager installing the compatible version.
    await fs.writeFile(path.join(modDir, "package.json"), JSON.stringify({ name: pkg, version: "3.0.66" }))

    const run = mockInstallRun()
    try {
      ;(Global.Path as { cache: string }).cache = tmp.path
      await expect(BunProc.install(pkg, "^3.0.0")).resolves.toBe(path.join(tmp.path, "node_modules", pkg))
      expect(run).toHaveBeenCalledTimes(1)
      const cmd = run.mock.calls[0]![0]
      expect(cmd[cmd.length - 1]).toBe("@ai-sdk/anthropic@^3.0.0")
      // The concrete installed version is recorded so subsequent starts
      // compare against the range instead of reinstalling every time.
      const updated = JSON.parse(await fs.readFile(manifest, "utf-8"))
      expect(updated.dependencies[pkg]).toBe("3.0.66")
    } finally {
      run.mockRestore()
      ;(Global.Path as { cache: string }).cache = originalCache
    }
  })

  test("reuses the cache when the cached version satisfies the requested range", async () => {
    await using tmp = await tmpdir()
    const originalCache = Global.Path.cache
    const pkg = "@ai-sdk/anthropic"
    const manifest = path.join(tmp.path, "package.json")
    const modDir = path.join(tmp.path, "node_modules", "@ai-sdk", "anthropic")
    await fs.mkdir(modDir, { recursive: true })
    await fs.writeFile(manifest, JSON.stringify({ dependencies: { [pkg]: "3.0.66" } }))

    const run = mockInstallRun()
    try {
      ;(Global.Path as { cache: string }).cache = tmp.path
      await expect(BunProc.install(pkg, "^3.0.0")).resolves.toBe(path.join(tmp.path, "node_modules", pkg))
      expect(run).not.toHaveBeenCalled()
    } finally {
      run.mockRestore()
      ;(Global.Path as { cache: string }).cache = originalCache
    }
  })

  test("exact pins still short-circuit on string equality", async () => {
    await using tmp = await tmpdir()
    const originalCache = Global.Path.cache
    const pkg = "example-plugin"
    const manifest = path.join(tmp.path, "package.json")
    await fs.mkdir(path.join(tmp.path, "node_modules", pkg), { recursive: true })
    await fs.writeFile(manifest, JSON.stringify({ dependencies: { [pkg]: "1.0.0" } }))

    const run = mockInstallRun()
    try {
      ;(Global.Path as { cache: string }).cache = tmp.path
      await expect(BunProc.install(pkg, "1.0.0")).resolves.toBe(path.join(tmp.path, "node_modules", pkg))
      expect(run).not.toHaveBeenCalled()
    } finally {
      run.mockRestore()
      ;(Global.Path as { cache: string }).cache = originalCache
    }
  })
})
