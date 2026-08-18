import { afterEach, describe, expect, test, vi, type MockInstance } from "vitest"
import semver from "semver"
import { Bus } from "../../src/bus"
import { upgrade } from "../../src/cli/upgrade"
import { Config } from "../../src/config/config"
import { Installation } from "../../src/installation"

let configSpy: MockInstance | undefined
let methodSpy: MockInstance | undefined
let latestSpy: MockInstance | undefined
let installSpy: MockInstance | undefined
let publishSpy: MockInstance | undefined

afterEach(() => {
  configSpy?.mockRestore()
  methodSpy?.mockRestore()
  latestSpy?.mockRestore()
  installSpy?.mockRestore()
  publishSpy?.mockRestore()
})

function setup(input: { config?: object; method?: Installation.Method; latest: string }) {
  configSpy = vi.spyOn(Config, "global").mockResolvedValue((input.config ?? {}) as any)
  methodSpy = vi.spyOn(Installation, "method").mockResolvedValue(input.method ?? "curl")
  latestSpy = vi.spyOn(Installation, "latest").mockResolvedValue(input.latest)
  installSpy = vi.spyOn(Installation, "upgrade").mockResolvedValue(undefined as any)
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

  test("notifies instead of installing patches when autoupdate is 'notify'", async () => {
    setup({ config: { autoupdate: "notify" }, latest: patch })

    await upgrade()

    expect(installSpy).not.toHaveBeenCalled()
    expect(publishSpy).toHaveBeenCalledWith(Installation.Event.UpdateAvailable, { version: patch })
  })

  test("never auto-installs when the install method is unknown", async () => {
    setup({ method: "unknown", latest: patch })

    await upgrade()

    expect(installSpy).not.toHaveBeenCalled()
    expect(publishSpy).not.toHaveBeenCalled()
  })

  test("falls back to the update-available notification when the install fails", async () => {
    setup({ latest: patch })
    installSpy!.mockRejectedValue(new Installation.UpgradeFailedError({ stderr: "boom" }))

    await upgrade()

    expect(publishSpy).toHaveBeenCalledWith(Installation.Event.UpdateAvailable, { version: patch })
    expect(publishSpy).not.toHaveBeenCalledWith(Installation.Event.Updated, expect.anything())
  })
})
