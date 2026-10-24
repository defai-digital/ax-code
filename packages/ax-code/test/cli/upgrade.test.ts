import { afterEach, describe, expect, test, vi, type MockInstance } from "vitest"
import semver from "semver"
import { Bus } from "../../src/bus"
import { upgrade } from "../../src/cli/upgrade"
import {
  decideUnknownUpgrade,
  renderUpgradeCheckHuman,
  runUpgradeCheck,
  UpgradeCheckCommand,
} from "../../src/cli/cmd/upgrade"
import { Config } from "../../src/config/config"
import { Flag } from "../../src/flag/flag"
import { Installation } from "../../src/installation"

let configSpy: MockInstance | undefined
let methodSpy: MockInstance | undefined
let latestSpy: MockInstance | undefined
let installSpy: MockInstance | undefined
let launcherSpy: MockInstance | undefined
let publishSpy: MockInstance | undefined
let originalDisableAutoUpdate: boolean | undefined

afterEach(() => {
  configSpy?.mockRestore()
  methodSpy?.mockRestore()
  latestSpy?.mockRestore()
  installSpy?.mockRestore()
  launcherSpy?.mockRestore()
  publishSpy?.mockRestore()
  if (originalDisableAutoUpdate !== undefined) {
    ;(Flag as { AX_CODE_DISABLE_AUTOUPDATE: boolean }).AX_CODE_DISABLE_AUTOUPDATE = originalDisableAutoUpdate
    originalDisableAutoUpdate = undefined
  }
})

function setup(input: { config?: object; method?: Installation.Method; latest: string }) {
  // Release validation intentionally exports AX_CODE_DISABLE_AUTOUPDATE=1.
  // These decision-matrix tests must control the flag explicitly instead of
  // inheriting the runner environment.
  originalDisableAutoUpdate = Flag.AX_CODE_DISABLE_AUTOUPDATE
  ;(Flag as { AX_CODE_DISABLE_AUTOUPDATE: boolean }).AX_CODE_DISABLE_AUTOUPDATE = false
  configSpy = vi.spyOn(Config, "global").mockResolvedValue((input.config ?? {}) as any)
  methodSpy = vi.spyOn(Installation, "method").mockResolvedValue(input.method ?? "curl")
  latestSpy = vi.spyOn(Installation, "latest").mockResolvedValue(input.latest)
  installSpy = vi.spyOn(Installation, "upgrade").mockResolvedValue(undefined as any)
  launcherSpy = vi.spyOn(Installation, "verifyActiveLauncher").mockResolvedValue({
    ok: true,
    launchers: ["/usr/local/bin/ax-code"],
    activePath: "/usr/local/bin/ax-code",
    activeVersion: input.latest,
  })
  publishSpy = vi.spyOn(Bus, "publish").mockResolvedValue(undefined as any)
}

const current = Installation.VERSION
const patch = semver.inc(current, "patch")!
const minor = semver.inc(current, "minor")!

describe("cli upgrade", () => {
  test("does not auto-downgrade when the discovered version is older", async () => {
    configSpy = vi.spyOn(Config, "global").mockResolvedValue({} as any)
    methodSpy = vi.spyOn(Installation, "method").mockResolvedValue("curl")
    latestSpy = vi.spyOn(Installation, "latest").mockResolvedValue("2.25.0")
    installSpy = vi.spyOn(Installation, "upgrade").mockResolvedValue(undefined as any)
    publishSpy = vi.spyOn(Bus, "publish").mockResolvedValue(undefined as any)

    await upgrade()

    expect(installSpy).not.toHaveBeenCalled()
    expect(publishSpy).not.toHaveBeenCalled()
  })

  test("does not notify or upgrade when discovered version is not semver", async () => {
    configSpy = vi.spyOn(Config, "global").mockResolvedValue({} as any)
    methodSpy = vi.spyOn(Installation, "method").mockResolvedValue("brew")
    latestSpy = vi.spyOn(Installation, "latest").mockResolvedValue("unknown")
    installSpy = vi.spyOn(Installation, "upgrade").mockResolvedValue(undefined as any)
    publishSpy = vi.spyOn(Bus, "publish").mockResolvedValue(undefined as any)

    await upgrade()

    expect(installSpy).not.toHaveBeenCalled()
    expect(publishSpy).not.toHaveBeenCalled()
  })

  test("reports false when the version probe fails so the caller does not consume the check interval", async () => {
    configSpy = vi.spyOn(Config, "global").mockResolvedValue({} as any)
    methodSpy = vi.spyOn(Installation, "method").mockResolvedValue("curl")
    latestSpy = vi.spyOn(Installation, "latest").mockRejectedValue(new Error("network down"))
    installSpy = vi.spyOn(Installation, "upgrade").mockResolvedValue(undefined as any)
    publishSpy = vi.spyOn(Bus, "publish").mockResolvedValue(undefined as any)

    expect(await upgrade()).toBe(false)

    expect(installSpy).not.toHaveBeenCalled()
    expect(publishSpy).not.toHaveBeenCalled()
  })

  test("reports true when the check completes, even with no update available", async () => {
    setup({ latest: current })

    expect(await upgrade()).toBe(true)

    expect(installSpy).not.toHaveBeenCalled()
    expect(publishSpy).not.toHaveBeenCalled()
  })

  test("auto-installs patch releases and publishes the updated event", async () => {
    setup({ latest: patch })

    await upgrade()

    expect(installSpy).toHaveBeenCalledWith("curl", patch)
    expect(publishSpy).toHaveBeenCalledWith(Installation.Event.Updated, { version: patch })
    expect(publishSpy).not.toHaveBeenCalledWith(Installation.Event.UpdateAvailable, expect.anything())
  })

  test("notifies without mutating Homebrew while agents may still use its keg", async () => {
    setup({ method: "brew", latest: patch })
    await upgrade()
    expect(installSpy).not.toHaveBeenCalled()
    expect(publishSpy).toHaveBeenCalledWith(Installation.Event.UpdateAvailable, { version: patch })
  })

  test("only notifies for minor releases", async () => {
    setup({ latest: minor })

    await upgrade()

    expect(installSpy).not.toHaveBeenCalled()
    expect(publishSpy).toHaveBeenCalledWith(Installation.Event.UpdateAvailable, { version: minor })
  })

  test("does nothing when autoupdate is disabled", async () => {
    setup({ config: { autoupdate: false }, latest: patch })

    await upgrade()

    expect(installSpy).not.toHaveBeenCalled()
    expect(publishSpy).not.toHaveBeenCalled()
  })

  test("does nothing when the process-level auto-update flag is disabled", async () => {
    setup({ latest: patch })
    ;(Flag as { AX_CODE_DISABLE_AUTOUPDATE: boolean }).AX_CODE_DISABLE_AUTOUPDATE = true

    await upgrade()

    expect(installSpy).not.toHaveBeenCalled()
    expect(publishSpy).not.toHaveBeenCalled()
  })

  test("notifies instead of installing patches when autoupdate is 'notify'", async () => {
    setup({ config: { autoupdate: "notify" }, latest: patch })

    await upgrade()

    expect(installSpy).not.toHaveBeenCalled()
    expect(publishSpy).toHaveBeenCalledWith(Installation.Event.UpdateAvailable, { version: patch })
  })

  test("notifies without auto-installing when the install method is unknown", async () => {
    setup({ method: "unknown", latest: patch })

    await upgrade()

    expect(installSpy).not.toHaveBeenCalled()
    expect(publishSpy).toHaveBeenCalledWith(Installation.Event.UpdateAvailable, { version: patch })
  })

  test("includes PATH-shadow warnings after a background patch update", async () => {
    setup({ latest: patch })
    launcherSpy!.mockResolvedValue({
      ok: false,
      launchers: ["/old/bin/ax-code", "/new/bin/ax-code"],
      activePath: "/old/bin/ax-code",
      activeVersion: current,
    })

    await upgrade()

    expect(publishSpy).toHaveBeenCalledWith(Installation.Event.Updated, {
      version: patch,
      warnings: [expect.stringContaining("/old/bin/ax-code")],
    })
  })

  test("falls back to the update-available notification when the install fails", async () => {
    setup({ latest: patch })
    installSpy!.mockRejectedValue(new Installation.UpgradeFailedError({ stderr: "boom" }))

    await upgrade()

    expect(publishSpy).toHaveBeenCalledWith(Installation.Event.UpdateAvailable, { version: patch })
    expect(publishSpy).not.toHaveBeenCalledWith(Installation.Event.Updated, expect.anything())
  })
})

describe("unknown upgrade decision", () => {
  const bundle = "C:/Users/test/AppData/Local/Programs/AX Code/resources/ax-code/lib/index-node-tui.js"
  const currentReport = {
    current,
    latest: current,
    upToDate: true as const,
    method: "unknown" as const,
  }

  test("reports up to date before prompting, including a desktop bundle", () => {
    expect(
      decideUnknownUpgrade({
        activePath: bundle,
        interactive: false,
        explicitTarget: false,
        desktop: true,
        report: currentReport,
      }),
    ).toEqual({ kind: "up-to-date", current, desktop: true, activePath: bundle })
  })

  test("refuses to replace a desktop bundle when a newer CLI release exists", () => {
    expect(
      decideUnknownUpgrade({
        activePath: bundle,
        interactive: true,
        explicitTarget: false,
        desktop: true,
        report: { current, latest: patch, upToDate: false, method: "unknown" },
      }),
    ).toMatchObject({ kind: "desktop", updateAvailable: true, latest: patch, activePath: bundle })
  })

  test("does not prompt when stdin is not a TTY", () => {
    const action = decideUnknownUpgrade({
      activePath: "C:/Program Files/ax-code/ax-code.exe",
      interactive: false,
      explicitTarget: false,
      desktop: false,
      report: { current, latest: patch, upToDate: false, method: "unknown" },
    })
    expect(action.kind).toBe("noninteractive")
    if (action.kind !== "noninteractive") return
    expect(action.exitCode).toBe(2)
    expect(action.message).toContain("--method curl|brew")
    expect(action.message).toContain(patch)
  })

  test("prompts on a TTY for an unknown non-desktop install and names that path", () => {
    const activePath = "C:/tools/ax-code.exe"
    expect(
      decideUnknownUpgrade({
        activePath,
        interactive: true,
        explicitTarget: false,
        desktop: false,
        report: { current, latest: patch, upToDate: false, method: "unknown" },
      }),
    ).toEqual({ kind: "prompt", activePath })
  })
})

describe("cli upgrade check", () => {
  test("reports up to date with exit 0 and the JSON report shape", async () => {
    methodSpy = vi.spyOn(Installation, "method").mockResolvedValue("curl")
    latestSpy = vi.spyOn(Installation, "latest").mockResolvedValue(current)

    const outcome = await runUpgradeCheck()

    expect(outcome.exitCode).toBe(0)
    expect(outcome.report).toEqual({ current, latest: current, upToDate: true, method: "curl" })
    expect(renderUpgradeCheckHuman(outcome.report)).toContain("up to date")
    expect(renderUpgradeCheckHuman(outcome.report)).toContain(current)
  })

  test("reports an available update with exit 1", async () => {
    methodSpy = vi.spyOn(Installation, "method").mockResolvedValue("brew")
    latestSpy = vi.spyOn(Installation, "latest").mockResolvedValue(patch)

    const outcome = await runUpgradeCheck()

    expect(outcome.exitCode).toBe(1)
    expect(outcome.report).toEqual({ current, latest: patch, upToDate: false, method: "brew" })
    expect(renderUpgradeCheckHuman(outcome.report)).toContain("update available")
    expect(renderUpgradeCheckHuman(outcome.report)).toContain(patch)
    expect(renderUpgradeCheckHuman(outcome.report)).toContain("ax-code upgrade")
  })

  test("treats a current version newer than latest as up to date", async () => {
    methodSpy = vi.spyOn(Installation, "method").mockResolvedValue("curl")
    latestSpy = vi.spyOn(Installation, "latest").mockResolvedValue("0.0.1")

    const outcome = await runUpgradeCheck()

    expect(outcome.exitCode).toBe(0)
    expect(outcome.report.upToDate).toBe(true)
  })

  test("fails with exit 2 when the latest version cannot be fetched", async () => {
    methodSpy = vi.spyOn(Installation, "method").mockResolvedValue("curl")
    latestSpy = vi.spyOn(Installation, "latest").mockRejectedValue(new Error("network down"))

    const outcome = await runUpgradeCheck()

    expect(outcome.exitCode).toBe(2)
    expect(outcome.report.current).toBe(current)
    expect(outcome.report.latest).toBeNull()
    expect(outcome.report.upToDate).toBeNull()
    expect(outcome.report.error).toContain("network down")
    expect(renderUpgradeCheckHuman(outcome.report)).toContain("upgrade check failed")
    expect(renderUpgradeCheckHuman(outcome.report)).toContain("network down")
  })

  test("compares the public release index when the install method is unknown", async () => {
    methodSpy = vi.spyOn(Installation, "method").mockResolvedValue("unknown")
    latestSpy = vi.spyOn(Installation, "latest").mockResolvedValue(current)

    const outcome = await runUpgradeCheck()

    expect(latestSpy).toHaveBeenCalledWith("curl")
    expect(outcome.exitCode).toBe(0)
    expect(outcome.report).toMatchObject({ method: "unknown", upToDate: true, latest: current })
    expect(outcome.report.error).toBeUndefined()
    expect(renderUpgradeCheckHuman(outcome.report)).toContain("up to date")
  })

  test("reports an available update for an unknown method without installing", async () => {
    methodSpy = vi.spyOn(Installation, "method").mockResolvedValue("unknown")
    latestSpy = vi.spyOn(Installation, "latest").mockResolvedValue(patch)

    const outcome = await runUpgradeCheck()

    expect(outcome.exitCode).toBe(1)
    expect(outcome.report).toMatchObject({ method: "unknown", upToDate: false, latest: patch })
    expect(renderUpgradeCheckHuman(outcome.report)).toContain("update available")
  })

  test("honors an explicit method without auto-detecting", async () => {
    methodSpy = vi.spyOn(Installation, "method").mockResolvedValue("unknown")
    latestSpy = vi.spyOn(Installation, "latest").mockResolvedValue(current)

    const outcome = await runUpgradeCheck({ method: "brew" })

    expect(methodSpy).not.toHaveBeenCalled()
    expect(latestSpy).toHaveBeenCalledWith("brew")
    expect(outcome.exitCode).toBe(0)
    expect(outcome.report.method).toBe("brew")
  })

  test("handler prints a single JSON document and sets the exit code", async () => {
    methodSpy = vi.spyOn(Installation, "method").mockResolvedValue("curl")
    latestSpy = vi.spyOn(Installation, "latest").mockResolvedValue(patch)
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    const previousExitCode = process.exitCode
    process.exitCode = undefined
    try {
      await UpgradeCheckCommand.handler({ json: true, method: undefined, _: [], $0: "ax-code" })

      const printed = writeSpy.mock.calls.map((call) => String(call[0])).join("")
      expect(JSON.parse(printed)).toEqual({ current, latest: patch, upToDate: false, method: "curl" })
      expect(process.exitCode).toBe(1)
    } finally {
      writeSpy.mockRestore()
      process.exitCode = previousExitCode
    }
  })
})

describe("cli upgrade busy installer", () => {
  test("stays quiet when another process is already installing", async () => {
    setup({ latest: patch })
    installSpy!.mockRejectedValue(new Installation.UpgradeBusyError())

    await upgrade()

    expect(publishSpy).not.toHaveBeenCalled()
  })
})
