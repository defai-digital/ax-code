import { afterEach, describe, expect, spyOn, test } from "bun:test"
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
    configSpy = spyOn(Config, "global").mockResolvedValue({} as any)
    methodSpy = spyOn(Installation, "method").mockResolvedValue("npm")
    latestSpy = spyOn(Installation, "latest").mockResolvedValue("2.25.0")
    installSpy = spyOn(Installation, "upgrade").mockResolvedValue(undefined as any)
    publishSpy = spyOn(Bus, "publish").mockResolvedValue(undefined as any)

    await upgrade()

    expect(installSpy).not.toHaveBeenCalled()
    expect(publishSpy).not.toHaveBeenCalled()
  })
})
