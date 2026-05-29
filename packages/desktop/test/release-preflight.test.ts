import { mkdtempSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { defaultMacEntitlementsPath } from "../src/packaging/entitlements"
import {
  createMacReleasePreflightReport,
  type MacReleasePreflightCommand,
  type MacReleasePreflightCommandResult,
  writeMacReleasePreflightReport,
} from "../src/packaging/release-preflight"

describe("mac release preflight", () => {
  test("passes when macOS tools, signing identity, notarization, and HTTPS feed are available", async () => {
    const report = await createMacReleasePreflightReport({
      platform: "darwin",
      signingIdentity: "Developer ID Application: Example",
      notarization: { appleId: "release@example.com", password: "app-password", teamId: "TEAM12345" },
      updateFeedUrl: "https://github.com/org/repo/releases/download/v1.2.3/",
      exists: () => true,
      commandRunner: fakeCommandRunner({
        identities: '1) ABCDEF "Developer ID Application: Example"\n',
      }),
    })

    expect(report.ready).toBe(true)
    expect(report.checks.tools.status).toBe("passed")
    expect(report.checks.entitlements.status).toBe("passed")
    expect(report.checks.updateFeedUrl.status).toBe("passed")
  })

  test("fails when the imported signing identity is not visible to codesign", async () => {
    const report = await createMacReleasePreflightReport({
      platform: "darwin",
      signingIdentity: "Developer ID Application: Missing",
      notarization: { profile: "ax-code-notary" },
      updateFeedUrl: "https://updates.example.test/ax-code/",
      exists: () => true,
      commandRunner: fakeCommandRunner({
        identities: '1) ABCDEF "Developer ID Application: Example"\n',
      }),
    })

    expect(report.ready).toBe(false)
    expect(report.checks.tools).toMatchObject({
      status: "failed",
      reason: "Configured code signing identity was not found in the keychain.",
    })
  })

  test("fails when the notary keychain profile is not usable", async () => {
    const report = await createMacReleasePreflightReport({
      platform: "darwin",
      signingIdentity: "Developer ID Application: Example",
      notarization: { profile: "ax-code-notary" },
      updateFeedUrl: "https://updates.example.test/ax-code/",
      exists: () => true,
      commandRunner: fakeCommandRunner({
        identities: '1) ABCDEF "Developer ID Application: Example"\n',
        notaryProfile: { exitCode: 1, stderr: "No Keychain password item found" },
      }),
    })

    expect(report.ready).toBe(false)
    expect(report.checks.notarization).toEqual({
      status: "failed",
      reason: "Notary keychain profile is unavailable: No Keychain password item found",
    })
  })

  test("fails before public release when the feed is not HTTPS", async () => {
    const report = await createMacReleasePreflightReport({
      platform: "darwin",
      signingIdentity: "Developer ID Application: Example",
      notarization: { profile: "ax-code-notary" },
      updateFeedUrl: "http://updates.example.test/ax-code/",
      exists: () => true,
      commandRunner: fakeCommandRunner({
        identities: '1) ABCDEF "Developer ID Application: Example"\n',
      }),
    })

    expect(report.ready).toBe(false)
    expect(report.checks.updateFeedUrl).toEqual({
      status: "failed",
      reason: "Update feed URL must use HTTPS.",
    })
  })

  test("fails when the mac release entitlements file is missing", async () => {
    const entitlementsPath = defaultMacEntitlementsPath()
    const report = await createMacReleasePreflightReport({
      platform: "darwin",
      signingIdentity: "Developer ID Application: Example",
      notarization: { profile: "ax-code-notary" },
      updateFeedUrl: "https://updates.example.test/ax-code/",
      exists: (file) => file !== entitlementsPath,
      commandRunner: fakeCommandRunner({
        identities: '1) ABCDEF "Developer ID Application: Example"\n',
      }),
    })

    expect(report.ready).toBe(false)
    expect(report.checks.entitlements).toEqual({
      status: "failed",
      reason: `Mac release entitlements file is missing: ${entitlementsPath}`,
    })
  })

  test("writes a machine-readable preflight report artifact", async () => {
    const outputPath = path.join(mkdtempSync(path.join(os.tmpdir(), "ax-code-release-preflight-")), "preflight.json")
    const report = await createMacReleasePreflightReport({
      platform: "darwin",
      signingIdentity: "Developer ID Application: Example",
      notarization: { profile: "ax-code-notary" },
      updateFeedUrl: "https://updates.example.test/ax-code/",
      exists: () => true,
      commandRunner: fakeCommandRunner({
        identities: '1) ABCDEF "Developer ID Application: Example"\n',
      }),
    })

    writeMacReleasePreflightReport(report, outputPath)

    expect(JSON.parse(readFileSync(outputPath, "utf8"))).toMatchObject({
      ready: true,
      checks: {
        platform: { status: "passed" },
        updateFeedUrl: { status: "passed" },
      },
    })
  })
})

function fakeCommandRunner(input: { identities: string; notaryProfile?: MacReleasePreflightCommandResult }) {
  return async (command: MacReleasePreflightCommand): Promise<MacReleasePreflightCommandResult> => {
    if (command.command === "/usr/bin/xcrun" && command.args.join(" ") === "--find notarytool") {
      return { exitCode: 0, stdout: "/usr/bin/notarytool\n" }
    }
    if (command.command === "/usr/bin/xcrun" && command.args.join(" ") === "--find stapler") {
      return { exitCode: 0, stdout: "/usr/bin/stapler\n" }
    }
    if (command.command === "/usr/bin/security" && command.args.join(" ") === "find-identity -v -p codesigning") {
      return { exitCode: 0, stdout: input.identities }
    }
    if (
      command.command === "/usr/bin/xcrun" &&
      command.args.join(" ") === "notarytool history --keychain-profile ax-code-notary"
    ) {
      return input.notaryProfile ?? { exitCode: 0, stdout: "Successfully received submission history.\n" }
    }
    return { exitCode: 1, stderr: `unexpected command: ${command.command} ${command.args.join(" ")}` }
  }
}
