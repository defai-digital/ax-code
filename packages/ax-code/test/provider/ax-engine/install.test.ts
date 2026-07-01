import { afterEach, beforeEach, describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"

import { AxEnginePaths } from "../../../src/provider/ax-engine/paths"
import {
  AX_ENGINE_ERROR,
  AX_ENGINE_EXPECTED_TEAM_ID,
  AX_ENGINE_INSTALL_ENV,
  type AxEngineBinaryRelease,
} from "../../../src/provider/ax-engine/constants"
import {
  getManagedBinary,
  installAxEngineBinary,
  isAxEngineInstallable,
  resolveInstallableRelease,
  type AxEngineInstallRuntime,
} from "../../../src/provider/ax-engine/install"
import { getDependencyStatus } from "../../../src/provider/ax-engine/dependency"

const RELEASE: AxEngineBinaryRelease = {
  version: "1.2.3",
  assetName: "ax-engine-1.2.3-darwin-arm64.tar.gz",
  url: "https://example.com/ax-engine-1.2.3-darwin-arm64.tar.gz",
  sha256: "a".repeat(64),
  teamId: AX_ENGINE_EXPECTED_TEAM_ID,
}

// A fake `installReleaseBin` that materializes an executable at `bin`, standing
// in for a real download+verify+extract.
const fakeInstall = (async (input: { bin: string }) => {
  await fs.mkdir(path.dirname(input.bin), { recursive: true })
  await fs.writeFile(input.bin, "#!/bin/sh\necho ax-engine\n", { mode: 0o755 })
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

  test("env override derives asset name, version, and team id", () => {
    const release = resolveInstallableRelease("darwin", "arm64", {
      [AX_ENGINE_INSTALL_ENV.url]: "https://example.com/dl/ax-engine-9.9.tar.gz",
      [AX_ENGINE_INSTALL_ENV.sha256]: "b".repeat(64),
      [AX_ENGINE_INSTALL_ENV.version]: "9.9",
    })
    expect(release).toEqual({
      version: "9.9",
      assetName: "ax-engine-9.9.tar.gz",
      url: "https://example.com/dl/ax-engine-9.9.tar.gz",
      sha256: "b".repeat(64),
      teamId: AX_ENGINE_EXPECTED_TEAM_ID,
    })
  })

  test("no override and no pinned release means nothing to install", () => {
    expect(resolveInstallableRelease("darwin", "arm64", {})).toBeUndefined()
    expect(isAxEngineInstallable("darwin", "arm64", {})).toBe(false)
    expect(isAxEngineInstallable("darwin", "arm64", { [AX_ENGINE_INSTALL_ENV.url]: "https://x/e.zip" })).toBe(true)
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
})
