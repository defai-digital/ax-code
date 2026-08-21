import { afterEach, describe, expect, test, vi } from "vitest"

const ENV_KEYS = ["AX_CODE_CHANNEL", "AX_CODE_BUMP", "AX_CODE_VERSION", "AX_CODE_RELEASE"]

async function loadScript(env: Record<string, string>) {
  vi.resetModules()
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, env)
  const { Script } = await import("../src/index.ts")
  return Script
}

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
})

describe("Script", () => {
  test("explicit version strips the leading v and resolves the latest channel", async () => {
    const Script = await loadScript({ AX_CODE_VERSION: "v1.2.3" })
    expect(Script.version).toBe("1.2.3")
    expect(Script.channel).toBe("latest")
    expect(Script.preview).toBe(false)
  })

  test("non-latest channel derives a timestamped preview version", async () => {
    const Script = await loadScript({ AX_CODE_CHANNEL: "beta" })
    expect(Script.channel).toBe("beta")
    expect(Script.preview).toBe(true)
    expect(Script.version).toMatch(/^0\.0\.0-beta-\d{14}$/)
  })

  test("preview channel is sanitized into a valid semver prerelease", async () => {
    const Script = await loadScript({ AX_CODE_CHANNEL: "feature/release" })
    expect(Script.preview).toBe(true)
    expect(Script.version).toMatch(/^0\.0\.0-feature-release-\d{14}$/)
  })
})
