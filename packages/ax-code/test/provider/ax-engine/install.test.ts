import { afterEach, beforeEach, describe, expect, test } from "vitest"
import fs from "fs/promises"
import { constants as fsConstants } from "fs"
import path from "path"
import os from "os"
import { execFileSync } from "child_process"
import { createHash } from "crypto"

import { AxEnginePaths } from "../../../src/provider/ax-engine/paths"
import { installReleaseBin } from "../../../src/lsp/server-releases"
import {
  AX_ENGINE_BINARY_RELEASE,
  AX_ENGINE_ERROR,
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

  test("env override derives version + asset name; team id is opt-in", () => {
    const base = {
      [AX_ENGINE_INSTALL_ENV.url]: "https://example.com/dl/ax-engine-9.9.tar.gz",
      [AX_ENGINE_INSTALL_ENV.sha256]: "b".repeat(64),
      [AX_ENGINE_INSTALL_ENV.version]: "9.9",
    }
    // ax-engine binaries are ad-hoc signed, so no Developer-ID team is enforced by default.
    expect(resolveInstallableRelease("darwin", "arm64", base)).toMatchObject({
      version: "9.9",
      assetName: "ax-engine-9.9.tar.gz",
      url: "https://example.com/dl/ax-engine-9.9.tar.gz",
      sha256: "b".repeat(64),
    })
    expect(resolveInstallableRelease("darwin", "arm64", base)?.teamId).toBeUndefined()
    // A team can still be required explicitly.
    expect(
      resolveInstallableRelease("darwin", "arm64", { ...base, [AX_ENGINE_INSTALL_ENV.teamId]: "TEAM123456" })?.teamId,
    ).toBe("TEAM123456")
  })

  test("falls back to the pinned release when there is no env override", () => {
    const pinned = resolveInstallableRelease("darwin", "arm64", {})
    expect(pinned?.version).toBe(AX_ENGINE_BINARY_RELEASE?.version)
    expect(pinned?.url).toBe(AX_ENGINE_BINARY_RELEASE?.url)
    expect(pinned?.sha256).toBe(AX_ENGINE_BINARY_RELEASE?.sha256)
    expect(isAxEngineInstallable("darwin", "arm64", {})).toBe(Boolean(AX_ENGINE_BINARY_RELEASE))
    // Non-Apple-Silicon-macOS never gets a release, pinned or not.
    expect(resolveInstallableRelease("linux", "arm64", {})).toBeUndefined()
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
      await fs.writeFile(path.join(stage, "ax-engine"), "#!/bin/sh\necho ax-engine-real\n", { mode: 0o755 })
      const tarPath = path.join(stage, "artifact.tar.gz")
      execFileSync("tar", ["-czf", tarPath, "-C", stage, "ax-engine"])
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

      let codesignCalledFor: string | undefined
      const result = await installAxEngineBinary(
        {},
        baseRuntime({
          resolveRelease: () => release,
          install: realInstall,
          verifyCodesign: async (binaryPath) => {
            codesignCalledFor = binaryPath
          },
        }),
      )

      const bin = AxEnginePaths.managedBinary("e2e-1")
      expect(result).toMatchObject({ installed: true, alreadyPresent: false, version: "e2e-1", binaryPath: bin })
      // The real binary was extracted, is executable, and carries its contents.
      await fs.access(bin, fsConstants.X_OK)
      expect(await fs.readFile(bin, "utf8")).toContain("ax-engine-real")
      // The signature gate ran against the extracted binary.
      expect(codesignCalledFor).toBe(bin)
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
})
