import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import {
  decodeProjectConfigValue,
  parseProjectConfigText,
  readProjectConfig,
  updateProjectConfig,
} from "../../src/server/routes/project-config"
import { tmpdir } from "../fixture/fixture"

describe("project config route decoding", () => {
  test("decodes already-parsed project config values", () => {
    expect(decodeProjectConfigValue({ model: "openai/gpt-5", super_long: true })).toEqual({
      model: "openai/gpt-5",
      super_long: true,
    })
  })

  test("parses valid project config JSON", () => {
    expect(parseProjectConfigText(JSON.stringify({ model: "openai/gpt-5", super_long: true }))).toEqual({
      model: "openai/gpt-5",
      super_long: true,
    })
  })

  test("strips unknown keys while preserving valid config fields", () => {
    expect(parseProjectConfigText(JSON.stringify({ model: "openai/gpt-5", unknown: true }))).toEqual({
      model: "openai/gpt-5",
    })
  })

  test("preserves raw objects when validation cannot recover a valid subset", () => {
    const parsed = parseProjectConfigText(JSON.stringify({ model: 123 })) as unknown
    expect(parsed).toEqual({
      model: 123,
    })
  })

  test("falls back to an empty config for malformed JSON", () => {
    expect(parseProjectConfigText("{not json")).toEqual({})
  })

  test.each(["[]", "null", '"model"'])("falls back to an empty config for non-object JSON: %s", (text) => {
    expect(parseProjectConfigText(text)).toEqual({})
  })

  test("surfaces unreadable project config during reads", async () => {
    if (process.platform === "win32") return

    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "ax-code.json")
    await Bun.write(file, JSON.stringify({ super_long: true }))
    await fs.chmod(file, 0)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(readProjectConfig()).rejects.toMatchObject({ code: "EACCES" })
        },
      })
    } finally {
      await fs.chmod(file, 0o600)
    }
  })

  test("does not overwrite malformed project config during updates", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "ax-code.json")
    const malformed = "{not json"
    await Bun.write(file, malformed)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(
          updateProjectConfig((config) => {
            config.super_long = true
          }),
        ).rejects.toThrow("Failed to parse project config JSON")
      },
    })

    expect(await Bun.file(file).text()).toBe(malformed)
  })

  test.each(["[]", "null", '"model"'])(
    "does not overwrite non-object project config during updates: %s",
    async (invalid) => {
      await using tmp = await tmpdir({ git: true })
      const file = path.join(tmp.path, "ax-code.json")
      await Bun.write(file, invalid)

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(
            updateProjectConfig((config) => {
              config.super_long = true
            }),
          ).rejects.toThrow("Project config must be a JSON object")
        },
      })

      expect(await Bun.file(file).text()).toBe(invalid)
    },
  )

  test("creates project config when it does not exist", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "ax-code.json")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await updateProjectConfig((config) => {
          config.super_long = true
        })
      },
    })

    expect(JSON.parse(await Bun.file(file).text())).toEqual({ super_long: true })
  })
})
