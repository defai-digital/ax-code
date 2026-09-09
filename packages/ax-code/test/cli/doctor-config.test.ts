import { expect, test } from "vitest"
import path from "path"
import { writeFile } from "fs/promises"
import { getDoctorConfiguration, getConfiguredCredentialProviders } from "../../src/cli/cmd/doctor-config"
import { Config } from "../../src/config/config"
import { Global } from "../../src/global"
import { tmpdir } from "../fixture/fixture"

test.each(["ax-code.json", "ax-code.jsonc"])(
  "standalone doctor loads global %s and detects configured credentials",
  async (filename) => {
    await using global = await tmpdir()
    await using project = await tmpdir({ git: true })
    const previous = Global.Path.config
    Object.assign(Global.Path, { config: global.path })
    Config.global.reset()
    try {
      const contents = JSON.stringify({ provider: { custom: { options: { apiKey: "test-secret-never-print" } } } })
      await writeFile(
        path.join(global.path, filename),
        filename.endsWith("jsonc") ? `// Global configuration\n${contents}` : contents,
      )
      const result = await getDoctorConfiguration(project.path)
      expect(result.check.status).toBe("ok")
      expect(result.check.detail).toContain("1 provider(s)")
      expect(getConfiguredCredentialProviders(result.config)).toEqual(["custom"])
      expect(result.check.detail).not.toContain("test-secret-never-print")
    } finally {
      Object.assign(Global.Path, { config: previous })
      Config.global.reset()
    }
  },
)

test("configuration failures are not reported as missing files and do not expose parse input", async () => {
  await using global = await tmpdir()
  await using project = await tmpdir({ git: true })
  const previous = Global.Path.config
  Object.assign(Global.Path, { config: global.path })
  Config.global.reset()
  try {
    await writeFile(
      path.join(global.path, "ax-code.json"),
      '{"provider": {"custom": {"options": {"apiKey": "test-secret-never-print"}}}, BROKEN',
    )
    const result = await getDoctorConfiguration(project.path)
    expect(result.check.status).toBe("fail")
    expect(result.config).toBeUndefined()
    expect(result.check.detail).not.toContain("test-secret-never-print")
  } finally {
    Object.assign(Global.Path, { config: previous })
    Config.global.reset()
  }
})

test("only nonblank configured key strings count as credential presence", () => {
  expect(
    getConfiguredCredentialProviders({
      provider: {
        valid: { options: { apiKey: "key" } },
        blank: { options: { apiKey: "  " } },
        missing: {},
        numeric: { options: { apiKey: 123 } },
      },
    }),
  ).toEqual(["valid"])
})

test("standalone doctor preserves project trust filtering for provider credentials", async () => {
  await using project = await tmpdir({
    git: true,
    config: { provider: { untrusted: { options: { apiKey: "project-key" } } } },
  })
  const result = await getDoctorConfiguration(project.path)
  expect(result.check.status).toBe("ok")
  expect(getConfiguredCredentialProviders(result.config)).not.toContain("untrusted")
})
