import { afterEach, beforeEach, describe, expect, test } from "vitest"
import fs from "fs/promises"
import { constants as fsConstants } from "fs"
import path from "path"
import os from "os"
import { execFileSync } from "child_process"
import { createHash } from "crypto"

import { AxEnginePaths } from "../../../src/provider/ax-engine/paths"
import { installReleaseBin } from "@ax-code/ax-code-intel/server-releases"
import {
  AX_ENGINE_BINARY_RELEASE,
  AX_ENGINE_ERROR,
  AX_ENGINE_INSTALL_ENV,
  type AxEngineBinaryRelease,
} from "../../../src/provider/ax-engine/constants"
import { AX_ENGINE_RUNTIME_REQUIRED_FILES } from "../../../src/provider/ax-engine/payload"
import { getBundledBinary } from "../../../src/provider/ax-engine/bundled"
import {
  getManagedBinary,
  installAxEngineBinary,
  isAxEngineInstallable,
  resolveInstallableRelease,
  type AxEngineInstallRuntime,
} from "../../../src/provider/ax-engine/install"
import { getDependencyStatus } from "../../../src/provider/ax-engine/dependency"

const RELEASE: AxEngineBinaryRelease = {
  version: "9.9.9",
  assetName: "ax-engine-9.9.9-darwin-arm64.tar.gz",
  url: "https://example.com/ax-engine-9.9.9-darwin-arm64.tar.gz",
  sha256: "a".repeat(64),
}

// A fake `installReleaseBin` that materializes an executable at `bin`, standing
// in for a real download+verify+extract.
async function writeRuntimePayload(dir: string, script = "#!/bin/sh\necho ax-engine 9.9.9\n") {
  await fs.mkdir(dir, { recursive: true })
  for (const name of AX_ENGINE_RUNTIME_REQUIRED_FILES) {
    const target = path.join(dir, name)
    if (name === "ax-engine" || name === "ax-engine-server") {
      await fs.writeFile(target, script, { mode: 0o755 })
    } else {
      await fs.writeFile(target, `${name}\n`)
    }
  }
}

const fakeInstall = (async (input: { bin: string }) => {
  await writeRuntimePayload(path.dirname(input.bin))
  return input.bin
}) as unknown as NonNullable<AxEngineInstallRuntime["install"]>

const baseRuntime = (overrides: Partial<AxEngineInstallRuntime> = {}): AxEngineInstallRuntime => ({
  requireEligibility: (async () => ({ supported: true })) as NonNullable<AxEngineInstallRuntime["requireEligibility"]>,
  resolveRelease: () => RELEASE,
  install: fakeInstall,
  verifyCodesign: async () => {},
  clearQuarantine: async () => {},
  ...overrides,
})

async function cleanup() {
  await fs.rm(AxEnginePaths.installState, { force: true }).catch(() => undefined)
  await fs.rm(AxEnginePaths.bin, { recursive: true, force: true }).catch(() => undefined)
}

beforeEach(cleanup)
afterEach(async () => {
  await cleanup()
  delete process.env[AX_ENGINE_INSTALL_ENV.url]
  delete process.env[AX_ENGINE_INSTALL_ENV.sha256]
  delete process.env[AX_ENGINE_INSTALL_ENV.version]
  delete process.env[AX_ENGINE_INSTALL_ENV.teamId]
})

describe("resolveInstallableRelease", () => {
  test("only offers a release on Apple Silicon macOS", () => {
    const env = { [AX_ENGINE_INSTALL_ENV.url]: "https://example.com/e.tar.gz" }
    expect(resolveInstallableRelease("darwin", "arm64", env)).toBeTruthy()
    expect(resolveInstallableRelease("darwin", "x64", env)).toBeUndefined()
    expect(resolveInstallableRelease("linux", "arm64", env)).toBeUndefined()
    expect(resolveInstallableRelease("win32", "arm64", env)).toBeUndefined()
  })

  test("env override derives version + asset name; team id is opt-in", () => {
    const base = {
      [AX_ENGINE_INSTALL_ENV.url]: "https://example.com/dl/ax-engine-9.9.tar.gz",
      [AX_ENGINE_INSTALL_ENV.sha256]: "b".repeat(64),
      [AX_ENGINE_INSTALL_ENV.version]: "9.9",
    }
    expect(resolveInstallableRelease("darwin", "arm64", base)).toMatchObject({
      version: "9.9",
      assetName: "ax-engine-9.9.tar.gz",
      url: "https://example.com/dl/ax-engine-9.9.tar.gz",
      sha256: "b".repeat(64),
      teamId: "N5ZUZDUJS6",
    })
    expect(
      resolveInstallableRelease("darwin", "arm64", { ...base, [AX_ENGINE_INSTALL_ENV.teamId]: "TEAM123456" })?.teamId,
    ).toBe("TEAM123456")
  })

  test("pins a self-contained darwin-arm64 release and refuses other hosts", () => {
    expect(AX_ENGINE_BINARY_RELEASE.version).toBe("7.5.3")
    expect(AX_ENGINE_BINARY_RELEASE.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(AX_ENGINE_BINARY_RELEASE.url.startsWith("https://")).toBe(true)
    expect(resolveInstallableRelease("darwin", "arm64", {})).toMatchObject({
      version: "7.5.3",
      sha256: AX_ENGINE_BINARY_RELEASE.sha256,
    })
    expect(isAxEngineInstallable("darwin", "arm64", {})).toBe(true)
    expect(resolveInstallableRelease("linux", "arm64", {})).toBeUndefined()
    expect(resolveInstallableRelease("win32", "x64", {})).toBeUndefined()
    expect(resolveInstallableRelease("win32", "arm64", {})).toBeUndefined()
    expect(isAxEngineInstallable("win32", "x64", {})).toBe(false)
  })
})

describe("installAxEngineBinary", () => {
  test("installs, records a marker, and is discoverable + idempotent", async () => {
    const first = await installAxEngineBinary({}, baseRuntime())
    expect(first).toMatchObject({ installed: true, alreadyPresent: false, version: RELEASE.version })
    expect(first.binaryPath).toBe(AxEnginePaths.managedBinary(RELEASE.version))

    const managed = await getManagedBinary()
    expect(managed).toEqual({ path: first.binaryPath, version: RELEASE.version })

    // Second call finds the existing install and does not re-download.
    let installCalls = 0
    const second = await installAxEngineBinary(
      {},
      baseRuntime({
        install: (async (input: { bin: string }) => {
          installCalls += 1
          return input.bin
        }) as unknown as NonNullable<AxEngineInstallRuntime["install"]>,
      }),
    )
    expect(second).toMatchObject({ installed: false, alreadyPresent: true, version: RELEASE.version })
    expect(installCalls).toBe(0)
  })

  test("throws and leaves no marker when the download/verify fails", async () => {
    await expect(
      installAxEngineBinary(
        {},
        baseRuntime({
          install: (async () => undefined) as unknown as NonNullable<AxEngineInstallRuntime["install"]>,
        }),
      ),
    ).rejects.toThrow(AX_ENGINE_ERROR.DownloadFailed)
    expect(await getManagedBinary()).toBeUndefined()
  })

  test("removes the binary and reports failure when signature verification fails", async () => {
    await expect(
      installAxEngineBinary(
        {},
        baseRuntime({
          verifyCodesign: async () => {
            throw new Error(`${AX_ENGINE_ERROR.BinaryMissing}: bad signature`)
          },
        }),
      ),
    ).rejects.toThrow(AX_ENGINE_ERROR.BinaryMissing)
    expect(await getManagedBinary()).toBeUndefined()
    await expect(fs.access(AxEnginePaths.managedBinary(RELEASE.version))).rejects.toBeTruthy()
  })

  test("fails when no installable release is available", async () => {
    await expect(installAxEngineBinary({}, baseRuntime({ resolveRelease: () => undefined }))).rejects.toThrow(
      AX_ENGINE_ERROR.BinaryMissing,
    )
  })

  test("refuses to install a release without a pinned sha256", async () => {
    await expect(
      installAxEngineBinary({}, baseRuntime({ resolveRelease: () => ({ ...RELEASE, sha256: undefined }) })),
    ).rejects.toThrow("without a pinned SHA-256")
    expect(await getManagedBinary()).toBeUndefined()
  })

  test("refuses to install a release from a non-https url", async () => {
    await expect(
      installAxEngineBinary(
        {},
        baseRuntime({ resolveRelease: () => ({ ...RELEASE, url: "http://example.com/ax-engine.tar.gz" }) }),
      ),
    ).rejects.toThrow("non-HTTPS")
    expect(await getManagedBinary()).toBeUndefined()
  })

  test("propagates platform ineligibility", async () => {
    await expect(
      installAxEngineBinary(
        {},
        baseRuntime({
          requireEligibility: (async () => {
            throw new Error(`${AX_ENGINE_ERROR.UnsupportedMacos}: macOS 26 or later is required`)
          }) as NonNullable<AxEngineInstallRuntime["requireEligibility"]>,
        }),
      ),
    ).rejects.toThrow(AX_ENGINE_ERROR.UnsupportedMacos)
  })
})

describe("dependency resolution picks up the managed binary", () => {
  beforeEach(() => {
    delete process.env.AX_ENGINE_BIN
  })

  test("resolves mode 'managed' once installed", async () => {
    await installAxEngineBinary({}, baseRuntime())
    const status = await getDependencyStatus()
    // A real ax-engine on PATH would win, but CI hosts don't have one.
    if (status.mode === "path") return
    expect(status.available).toBe(true)
    expect(status.mode).toBe("managed")
    expect(status.managedVersion).toBe(RELEASE.version)
    expect(status.binaryPath).toBe(AxEnginePaths.managedBinary(RELEASE.version))
  })

  test("falls back to doctor JSON when the Python wrapper has no --version command", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "axe-version-"))
    try {
      const binary = path.join(dir, "ax-engine")
      await fs.writeFile(
        binary,
        [
          "#!/bin/sh",
          'if [ "$1" = "--version" ]; then exit 2; fi',
          'if [ "$1" = "doctor" ]; then echo \'{"install":{"version":"6.11.0"}}\'; exit 0; fi',
          "exit 1",
          "",
        ].join("\n"),
        { mode: 0o755 },
      )
      const status = await getDependencyStatus({ binaryPath: binary })
      expect(status).toMatchObject({ available: true, mode: "configured", version: "6.11.0", blockers: [] })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("blocks configured AX Engine versions older than the supported contract", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "axe-version-"))
    try {
      const binary = path.join(dir, "ax-engine")
      await fs.writeFile(binary, "#!/bin/sh\necho 'ax-engine 6.6.0'\n", { mode: 0o755 })
      const status = await getDependencyStatus({ binaryPath: binary })
      expect(status.available).toBe(false)
      expect(status.version).toContain("6.6.0")
      expect(status.blockers.join(" ")).toContain("AX_ENGINE_VERSION_UNSUPPORTED")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("blocks managed installs older than the supported contract", async () => {
    const stale: AxEngineBinaryRelease = {
      version: "6.6.0",
      assetName: "ax-engine-6.6.0-darwin-arm64.tar.gz",
      url: "https://example.com/ax-engine-6.6.0-darwin-arm64.tar.gz",
      sha256: "c".repeat(64),
    }
    await installAxEngineBinary(
      {},
      baseRuntime({
        resolveRelease: () => stale,
        install: (async (input: { bin: string }) => {
          await writeRuntimePayload(path.dirname(input.bin), "#!/bin/sh\necho 'ax-engine 6.6.0'\n")
          return input.bin
        }) as unknown as NonNullable<AxEngineInstallRuntime["install"]>,
      }),
    )

    const status = await getDependencyStatus()
    // A real ax-engine on PATH would win; CI hosts typically don't have one.
    if (status.mode === "path") return
    // Managed AX Engine is deliberately Apple-Silicon-only. The test still
    // exercises installation bookkeeping above, but resolution must not
    // advertise that macOS runtime on Linux/Windows CI hosts.
    if (!isAxEngineInstallable()) {
      expect(status).toMatchObject({ mode: "missing", available: false, installable: false })
      return
    }
    expect(status.mode).toBe("managed")
    expect(status.available).toBe(false)
    expect(status.version).toContain("6.6.0")
    expect(status.blockers.join(" ")).toContain("AX_ENGINE_VERSION_UNSUPPORTED")
    expect(status.installable).toBe(isAxEngineInstallable())
  })
})

// Exercise the real download → sha256-verify → extract → chmod → marker path
// against a genuine .tar.gz artifact. Only the two external boundaries are
// stubbed: the HTTPS fetch (returns the local tarball bytes) and the macOS
// codesign check (a hand-rolled test binary is not Apple-notarized). Everything
// else — including the real installReleaseBin extraction — runs for real.
describe("end-to-end install of a real tarball artifact", () => {
  beforeEach(() => {
    delete process.env.AX_ENGINE_BIN
  })

  test("downloads, verifies, extracts, and resolves the managed binary", async () => {
    const stage = await fs.mkdtemp(path.join(os.tmpdir(), "axe-artifact-"))
    try {
      // A stand-in ax-engine executable, packed exactly how a release archive
      // is expected to be shaped: the binary at the top level of the tarball.
      await writeRuntimePayload(stage, "#!/bin/sh\necho ax-engine-real 9.9.9\n")
      const tarPath = path.join(stage, "artifact.tar.gz")
      execFileSync("tar", ["-czf", tarPath, "-C", stage, ...AX_ENGINE_RUNTIME_REQUIRED_FILES])
      const bytes = await fs.readFile(tarPath)
      const sha256 = createHash("sha256").update(bytes).digest("hex")
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

      const release: AxEngineBinaryRelease = {
        version: "e2e-1",
        assetName: "artifact.tar.gz",
        url: "https://example.com/ax-engine/artifact.tar.gz",
        sha256,
      }

      // Real installReleaseBin, but with the network fetch replaced by the
      // local tarball bytes so extraction/verification run against real files.
      const realInstall = ((opts: Parameters<typeof installReleaseBin>[0]) =>
        installReleaseBin({
          ...opts,
          fetcher: async () => ({ ok: true, arrayBuffer: async () => arrayBuffer }),
        })) as NonNullable<AxEngineInstallRuntime["install"]>

      const codesigned: string[] = []
      const result = await installAxEngineBinary(
        {},
        baseRuntime({
          resolveRelease: () => release,
          install: realInstall,
          verifyCodesign: async (binaryPath) => {
            codesigned.push(binaryPath)
          },
        }),
      )

      const bin = AxEnginePaths.managedBinary("e2e-1")
      expect(result).toMatchObject({ installed: true, alreadyPresent: false, version: "e2e-1", binaryPath: bin })
      // The real binary was extracted, is executable, and carries its contents.
      await fs.access(bin, fsConstants.X_OK)
      expect(await fs.readFile(bin, "utf8")).toContain("ax-engine-real")
      expect(await fs.readFile(path.join(path.dirname(bin), "mlx.metallib"), "utf8")).toContain("mlx.metallib")
      expect(codesigned).toContain(bin)
      // And it now resolves as the managed dependency.
      expect(await getManagedBinary()).toEqual({ path: bin, version: "e2e-1" })
      const status = await getDependencyStatus()
      if (status.mode !== "path") {
        expect(status.mode).toBe("managed")
        expect(status.binaryPath).toBe(bin)
      }
    } finally {
      await fs.rm(stage, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  test("refuses a payload that is missing mlx.metallib", async () => {
    const stage = await fs.mkdtemp(path.join(os.tmpdir(), "axe-incomplete-"))
    try {
      await fs.writeFile(path.join(stage, "ax-engine"), "#!/bin/sh\necho ax-engine\n", { mode: 0o755 })
      const tarPath = path.join(stage, "artifact.tar.gz")
      execFileSync("tar", ["-czf", tarPath, "-C", stage, "ax-engine"])
      const bytes = await fs.readFile(tarPath)
      const sha256 = createHash("sha256").update(bytes).digest("hex")
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const realInstall = ((opts: Parameters<typeof installReleaseBin>[0]) =>
        installReleaseBin({
          ...opts,
          fetcher: async () => ({ ok: true, arrayBuffer: async () => arrayBuffer }),
        })) as NonNullable<AxEngineInstallRuntime["install"]>

      await expect(
        installAxEngineBinary(
          {},
          baseRuntime({
            resolveRelease: () => ({
              version: "incomplete-1",
              assetName: "artifact.tar.gz",
              url: "https://example.com/ax-engine/artifact.tar.gz",
              sha256,
            }),
            install: realInstall,
          }),
        ),
      ).rejects.toThrow("mlx.metallib")
      expect(await getManagedBinary()).toBeUndefined()
    } finally {
      await fs.rm(stage, { recursive: true, force: true }).catch(() => undefined)
    }
  })
})

describe("bundled sidecar resolution", () => {
  test("resolves engine/<version>/ax-engine next to a node-bundled entry", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "axe-bundled-"))
    try {
      const dir = path.join(root, "engine", AX_ENGINE_BINARY_RELEASE.version)
      await writeRuntimePayload(dir, "#!/bin/sh\necho ax-engine 7.4.0\n")
      const entry = path.join(root, "lib", "index-node-tui.js")
      await fs.mkdir(path.dirname(entry), { recursive: true })
      await fs.writeFile(entry, "export {}\n")

      const bundled = await getBundledBinary({ entryPath: entry })
      expect(bundled).toEqual({
        path: path.join(dir, "ax-engine"),
        version: AX_ENGINE_BINARY_RELEASE.version,
      })

      const status = await getDependencyStatus({ entryPath: entry })
      if (status.mode === "path") return
      expect(status.mode).toBe("bundled")
      expect(status.available).toBe(true)
      expect(status.binaryPath).toBe(bundled?.path)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("ignores a source-mode TypeScript entry", async () => {
    expect(await getBundledBinary({ entryPath: "/repo/packages/ax-code/src/index-node-tui.ts" })).toBeUndefined()
  })
})
