import { afterEach, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../../fixture/fixture"
import { Process } from "../../../src/util/process"
import * as Which from "../../../src/util/which"
import * as Install from "../../../src/provider/ax-engine/install"
import * as Bundled from "../../../src/provider/ax-engine/bundled"
import { getDependencyStatus } from "../../../src/provider/ax-engine/dependency"

const response = (text: string, code = 0): Process.TextResult => ({
  code,
  text,
  stdout: Buffer.from(text),
  stderr: Buffer.alloc(0),
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

async function launcher(dir: string) {
  const binaryPath = path.join(dir, "ax-engine")
  await fs.writeFile(binaryPath, "launcher", { mode: 0o755 })
  return binaryPath
}

function doctor() {
  return vi.spyOn(Process, "text").mockImplementation(async (args) => {
    if (args[1] === "--version") return response("", 2)
    return response(JSON.stringify({ install: { version: "7.5.1" } }))
  })
}

test("coalesces concurrent wrapper probes and reuses a successful doctor version", async () => {
  await using dir = await tmpdir()
  const binaryPath = await launcher(dir.path)
  const probe = doctor()
  const results = await Promise.all(Array.from({ length: 8 }, () => getDependencyStatus({ binaryPath })))
  for (const status of results) expect(status.version).toBe("7.5.1")
  expect((await getDependencyStatus({ binaryPath })).version).toBe("7.5.1")
  expect(probe).toHaveBeenCalledTimes(2)
  // Availability must still be checked even with a cached version.
  await fs.rm(binaryPath)
  expect((await getDependencyStatus({ binaryPath })).available).toBe(false)
  expect(probe).toHaveBeenCalledTimes(2)
})

test("invalidates on launcher replacement and native sibling appearance or replacement", async () => {
  await using dir = await tmpdir()
  const binaryPath = await launcher(dir.path)
  const probe = doctor()
  await getDependencyStatus({ binaryPath })
  await fs.writeFile(binaryPath, "replacement launcher")
  await getDependencyStatus({ binaryPath })
  const native = path.join(dir.path, "ax-engine-server")
  await fs.writeFile(native, "native")
  await getDependencyStatus({ binaryPath })
  await fs.writeFile(native, "replacement native")
  await getDependencyStatus({ binaryPath })
  await fs.rm(native)
  await getDependencyStatus({ binaryPath })
  expect(probe).toHaveBeenCalledTimes(10)
})

test.skipIf(process.platform === "win32")("invalidates when a launcher symlink is retargeted", async () => {
  await using dir = await tmpdir()
  const first = await launcher(dir.path)
  const second = path.join(dir.path, "replacement")
  await fs.writeFile(second, "replacement", { mode: 0o755 })
  const binaryPath = path.join(dir.path, "current")
  await fs.symlink(first, binaryPath)
  const probe = doctor()
  await getDependencyStatus({ binaryPath })
  await fs.unlink(binaryPath)
  await fs.symlink(second, binaryPath)
  await getDependencyStatus({ binaryPath })
  expect(probe).toHaveBeenCalledTimes(4)
})

test("bounds reuse when wrapper dependencies change without an executable change", async () => {
  await using dir = await tmpdir()
  const binaryPath = await launcher(dir.path)
  const clock = vi.spyOn(performance, "now").mockReturnValue(0)
  const probe = doctor()
  await getDependencyStatus({ binaryPath })
  clock.mockReturnValue(299_999)
  await getDependencyStatus({ binaryPath })
  expect(probe).toHaveBeenCalledTimes(2)
  clock.mockReturnValue(300_000)
  await getDependencyStatus({ binaryPath })
  expect(probe).toHaveBeenCalledTimes(4)
})

test("reads doctor install.version when the host is not ready", async () => {
  await using dir = await tmpdir()
  const binaryPath = await launcher(dir.path)
  vi.spyOn(Process, "text").mockImplementation(async (args) => {
    if (args[1] === "--version") return response("", 2)
    return response('doctor: not ready\n{"result":"not_ready","install":{"version":"7.5.3"}}', 1)
  })
  const status = await getDependencyStatus({ binaryPath })
  expect(status.version).toBe("7.5.3")
  expect(status.available).toBe(true)
})

test("does not warn when AX_ENGINE_BIN is only whitespace or the same binary", async () => {
  await using dir = await tmpdir()
  const binaryPath = await launcher(dir.path)
  vi.spyOn(Process, "text").mockResolvedValue(response("ax-engine 7.5.3"))
  const previous = process.env.AX_ENGINE_BIN
  try {
    process.env.AX_ENGINE_BIN = `  ${binaryPath}  `
    const same = await getDependencyStatus({ binaryPath })
    expect(same.binaryPath).toBe(binaryPath)
    expect(same.warnings.join(" ")).not.toContain("AX_ENGINE_BIN")
    process.env.AX_ENGINE_BIN = "   "
    const blank = await getDependencyStatus({ binaryPath })
    expect(blank.binaryPath).toBe(binaryPath)
    expect(blank.warnings.join(" ")).not.toContain("ignored")
  } finally {
    if (previous === undefined) delete process.env.AX_ENGINE_BIN
    else process.env.AX_ENGINE_BIN = previous
  }
})

test("warns when a configured binary path shadows AX_ENGINE_BIN", async () => {
  await using dir = await tmpdir()
  const binaryPath = await launcher(dir.path)
  vi.spyOn(Process, "text").mockResolvedValue(response("ax-engine 7.5.3"))
  const previous = process.env.AX_ENGINE_BIN
  process.env.AX_ENGINE_BIN = "/env/ax-engine"
  try {
    const status = await getDependencyStatus({ binaryPath })
    expect(status).toMatchObject({ mode: "configured", binaryPath, version: "ax-engine 7.5.3" })
    expect(status.warnings.join(" ")).toContain("AX_ENGINE_BIN")
    expect(status.warnings.join(" ")).toContain("/env/ax-engine")
  } finally {
    if (previous === undefined) delete process.env.AX_ENGINE_BIN
    else process.env.AX_ENGINE_BIN = previous
  }
})

test("failed probes are retryable without waiting for expiry", async () => {
  await using dir = await tmpdir()
  const binaryPath = await launcher(dir.path)
  const probe = vi.spyOn(Process, "text").mockResolvedValue(response("", 2))
  expect((await getDependencyStatus({ binaryPath })).version).toBeUndefined()
  probe.mockResolvedValue(response("ax-engine 7.5.1"))
  expect((await getDependencyStatus({ binaryPath })).version).toBe("ax-engine 7.5.1")
  expect(probe).toHaveBeenCalledTimes(3)
})

test("does not cache a version observed during an executable replacement", async () => {
  await using dir = await tmpdir()
  const binaryPath = await launcher(dir.path)
  const probe = vi
    .spyOn(Process, "text")
    .mockImplementationOnce(async () => {
      await fs.writeFile(binaryPath, "changed during version probe")
      return response("ax-engine 7.4.0")
    })
    .mockResolvedValue(response("ax-engine 7.5.1"))
  expect((await getDependencyStatus({ binaryPath })).version).toBe("ax-engine 7.4.0")
  expect((await getDependencyStatus({ binaryPath })).version).toBe("ax-engine 7.5.1")
  expect(probe).toHaveBeenCalledTimes(2)
})

test("an older failed probe cannot evict a replacement binary's successful probe", async () => {
  await using dir = await tmpdir()
  const binaryPath = await launcher(dir.path)
  const started = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<Process.TextResult>()
  const probe = vi
    .spyOn(Process, "text")
    .mockImplementationOnce(() => {
      started.resolve()
      return finish.promise
    })
    .mockImplementation(async (args) =>
      response(args[1] === "--version" ? "ax-engine 7.5.1" : "", args[1] === "--version" ? 0 : 2),
    )
  const old = getDependencyStatus({ binaryPath })
  await started.promise
  await fs.writeFile(binaryPath, "upgraded launcher")
  expect((await getDependencyStatus({ binaryPath })).version).toBe("ax-engine 7.5.1")
  finish.resolve(response("", 2))
  expect((await old).version).toBeUndefined()
  expect((await getDependencyStatus({ binaryPath })).version).toBe("ax-engine 7.5.1")
  expect(probe).toHaveBeenCalledTimes(3)
})

test("evicts old version probes when many distinct executables are resolved", async () => {
  await using dir = await tmpdir()
  const probe = vi.spyOn(Process, "text").mockResolvedValue(response("ax-engine 7.5.1"))
  const paths = Array.from({ length: 65 }, (_, i) => path.join(dir.path, `engine-${i}`))
  for (const binaryPath of paths) {
    await fs.writeFile(binaryPath, "launcher", { mode: 0o755 })
    await getDependencyStatus({ binaryPath })
  }
  await getDependencyStatus({ binaryPath: paths[0] })
  expect(probe).toHaveBeenCalledTimes(66)
})

test.each(["path", "managed"] as const)(
  "skips a pre-Tiel %s runtime in favor of the bundled engine",
  async (source) => {
    await using dir = await tmpdir()
    const old = await launcher(dir.path)
    const bundled = path.join(dir.path, "bundled")
    await fs.writeFile(bundled, "bundled launcher", { mode: 0o755 })
    vi.spyOn(Which, "which").mockReturnValue(source === "path" ? old : null)
    vi.spyOn(Install, "getManagedBinary").mockResolvedValue(
      source === "managed" ? { path: old, version: "7.4.0" } : undefined,
    )
    vi.spyOn(Bundled, "getBundledBinary").mockResolvedValue({ path: bundled, version: "7.5.3" })
    vi.spyOn(Process, "text").mockImplementation(async (args) =>
      response(`ax-engine ${args[0] === old ? "7.4.0" : "7.5.3"}`),
    )
    const status = await getDependencyStatus()
    expect(status).toMatchObject({ available: true, mode: "bundled", binaryPath: bundled, version: "ax-engine 7.5.3" })
    expect(status.warnings.join(" ")).toContain("7.4.0")
  },
)

test("keeps a compatible PATH engine and explicit older overrides", async () => {
  await using dir = await tmpdir()
  const binaryPath = await launcher(dir.path)
  vi.spyOn(Which, "which").mockReturnValue(binaryPath)
  const probe = vi.spyOn(Process, "text").mockResolvedValue(response("ax-engine 7.5.0"))
  expect(await getDependencyStatus()).toMatchObject({ available: true, mode: "path", binaryPath })
  await fs.writeFile(binaryPath, "explicit older launcher")
  probe.mockResolvedValue(response("ax-engine 7.4.0"))
  expect(await getDependencyStatus({ binaryPath })).toMatchObject({ available: true, mode: "configured", binaryPath })
})

test.each([undefined, "dev"])(
  "does not let an unverified PATH version %s hide the bundled engine",
  async (detected) => {
    await using dir = await tmpdir()
    const old = await launcher(dir.path)
    const bundled = path.join(dir.path, "bundled")
    await fs.writeFile(bundled, "bundled launcher", { mode: 0o755 })
    vi.spyOn(Which, "which").mockReturnValue(old)
    vi.spyOn(Install, "getManagedBinary").mockResolvedValue(undefined)
    vi.spyOn(Bundled, "getBundledBinary").mockResolvedValue({ path: bundled, version: "7.5.3" })
    vi.spyOn(Process, "text").mockImplementation(async (args) =>
      args[0] === bundled ? response("ax-engine 7.5.3") : response(detected ?? "", detected ? 0 : 2),
    )
    expect(await getDependencyStatus()).toMatchObject({ available: true, mode: "bundled", binaryPath: bundled })
  },
)

test("warns when AX_ENGINE_BIN is shadowed by a configured binaryPath", async () => {
  await using dir = await tmpdir()
  const binaryPath = await launcher(dir.path)
  vi.spyOn(Process, "text").mockResolvedValue(response("ax-engine 7.5.3"))
  vi.stubEnv("AX_ENGINE_BIN", "/elsewhere/ax-engine")
  const status = await getDependencyStatus({ binaryPath })
  expect(status.mode).toBe("configured")
  expect(status.binaryPath).toBe(binaryPath)
  expect(status.warnings.join("\n")).toContain("AX_ENGINE_BIN (/elsewhere/ax-engine) is ignored")
})

test("does not warn when AX_ENGINE_BIN resolves to the configured binary", async () => {
  await using dir = await tmpdir()
  const binaryPath = await launcher(dir.path)
  vi.spyOn(Process, "text").mockResolvedValue(response("ax-engine 7.5.3"))
  vi.stubEnv("AX_ENGINE_BIN", `  ${binaryPath}  `)
  const status = await getDependencyStatus({ binaryPath })
  expect(status.binaryPath).toBe(binaryPath)
  expect(status.warnings.join("\n")).not.toContain("AX_ENGINE_BIN")
})

test("does not warn when no AX_ENGINE_BIN override is set", async () => {
  await using dir = await tmpdir()
  const binaryPath = await launcher(dir.path)
  vi.spyOn(Process, "text").mockResolvedValue(response("ax-engine 7.5.3"))
  const status = await getDependencyStatus({ binaryPath })
  expect(status.warnings.join("\n")).not.toContain("AX_ENGINE_BIN")
})
