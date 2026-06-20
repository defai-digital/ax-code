import { afterEach, describe, expect, test, vi } from "vitest"
import { Bus } from "../../src/bus"
import { upgrade } from "../../src/cli/upgrade"
import { Config } from "../../src/config/config"
import { Installation } from "../../src/installation"

let configSpy: ReturnType<typeof spyOn<typeof Config, "global">> | undefined
let methodSpy: ReturnType<typeof spyOn<typeof Installation, "method">> | undefined
let latestSpy: ReturnType<typeof spyOn<typeof Installation, "latest">> | undefined
let installSpy: ReturnType<typeof spyOn<typeof Installation, "upgrade">> | undefined
let publishSpy: ReturnType<typeof spyOn<typeof Bus, "publish">> | undefined

afterEach(() => {
  configSpy?.mockRestore()
  methodSpy?.mockRestore()
  latestSpy?.mockRestore()
  installSpy?.mockRestore()
  publishSpy?.mockRestore()
})

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
})
