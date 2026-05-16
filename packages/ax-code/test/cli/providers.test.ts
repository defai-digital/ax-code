import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as prompts from "@clack/prompts"
import fs from "fs/promises"
import path from "path"
import { Auth } from "../../src/auth"
import { DEFAULT_LOGIN_PROVIDER_IDS, ProvidersListCommand } from "../../src/cli/cmd/providers"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"

const originalCwd = process.cwd()
const authFile = path.join(Global.Path.data, "auth.json")
const authLockFile = `${authFile}.lock`

afterEach(async () => {
  process.chdir(originalCwd)
  await Bun.write(authFile, "{}")
  await fs.unlink(authLockFile).catch(() => undefined)
  await Instance.disposeAll()
  mock.restore()
})

describe("providers command", () => {
  test("default login provider set includes CLI bridge providers", () => {
    expect(DEFAULT_LOGIN_PROVIDER_IDS.has("claude-code")).toBe(true)
    expect(DEFAULT_LOGIN_PROVIDER_IDS.has("gemini-cli")).toBe(true)
    expect(DEFAULT_LOGIN_PROVIDER_IDS.has("codex-cli")).toBe(true)
  })

  test("providers list reports saved credentials", async () => {
    const introSpy = spyOn(prompts, "intro").mockImplementation(() => {})
    const outroSpy = spyOn(prompts, "outro").mockImplementation(() => {})
    const infoSpy = spyOn(prompts.log, "info").mockImplementation(() => {})

    try {
      await Auth.set("xai", { type: "api", key: "sk-test" })
      await ProvidersListCommand.handler({} as any)

      expect(infoSpy).toHaveBeenCalled()
      expect(
        infoSpy.mock.calls.some(([message]) => String(message).includes("xAI") || String(message).includes("xai")),
      ).toBe(true)
      expect(outroSpy).toHaveBeenCalledWith("1 credentials")
    } finally {
      introSpy.mockRestore()
      outroSpy.mockRestore()
      infoSpy.mockRestore()
    }
  })
})
