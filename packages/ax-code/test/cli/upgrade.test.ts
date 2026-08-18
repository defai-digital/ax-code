import { afterEach, describe, expect, test, vi, type MockInstance } from "vitest"
import semver from "semver"
import { Bus } from "../../src/bus"
import { upgrade } from "../../src/cli/upgrade"
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

  test("auto-installs patch releases and publishes the updated event", async () => {
    setup({ latest: patch })

    await upgrade()

    expect(installSpy).toHaveBeenCalledWith("curl", patch)
    expect(publishSpy).toHaveBeenCalledWith(Installation.Event.Updated, { version: patch })
    expect(publishSpy).not.toHaveBeenCalledWith(Installation.Event.UpdateAvailable, expect.anything())
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
