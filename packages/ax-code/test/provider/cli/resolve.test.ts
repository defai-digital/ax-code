import fs from "node:fs/promises"
import path from "node:path"
import { test, expect, describe } from "vitest"
import { parseCliSettingsJson, resolveCliModel } from "../../../src/provider/cli/resolve"
import { tmpdir } from "../../fixture/fixture"

describe("resolveCliModel", () => {
  test("parseCliSettingsJson decodes object settings", () => {
    expect(parseCliSettingsJson(JSON.stringify({ model: "claude-sonnet-4-6" }))).toEqual({
      model: "claude-sonnet-4-6",
    })
  })

  test("parseCliSettingsJson rejects invalid and non-object settings", () => {
    expect(parseCliSettingsJson("{not json")).toBeNull()
    expect(parseCliSettingsJson("[]")).toBeNull()
    expect(parseCliSettingsJson('"claude-sonnet-4-6"')).toBeNull()
  })

  test("returns default for claude-code when no config exists", async () => {
    const original = process.env.ANTHROPIC_MODEL
    delete process.env.ANTHROPIC_MODEL
    try {
      const info = await resolveCliModel("claude-code")
      // If no settings file and no env var, defer to the CLI's own default model.
      if (info.source === "default") {
        expect(info.model).toBe("claude-code")
      }
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_MODEL = original
    }
  })

  test("claude-code reads settings from isolated test home", async () => {
    await using tmp = await tmpdir()
    const originalHome = process.env.AX_CODE_TEST_HOME
    const originalModel = process.env.ANTHROPIC_MODEL
    process.env.AX_CODE_TEST_HOME = tmp.path
    delete process.env.ANTHROPIC_MODEL
    try {
      const settingsDir = path.join(tmp.path, ".claude")
      await fs.mkdir(settingsDir, { recursive: true })
      await fs.writeFile(path.join(settingsDir, "settings.json"), JSON.stringify({ model: "claude-sonnet-4-6" }))

      const info = await resolveCliModel("claude-code")
      expect(info).toEqual({
        model: "claude-sonnet-4-6",
        source: "~/.claude/settings.json",
      })
    } finally {
      if (originalHome !== undefined) process.env.AX_CODE_TEST_HOME = originalHome
      else delete process.env.AX_CODE_TEST_HOME
      if (originalModel !== undefined) process.env.ANTHROPIC_MODEL = originalModel
      else delete process.env.ANTHROPIC_MODEL
    }
  })

  test.skipIf(process.platform === "win32")("claude-code surfaces settings access errors", async () => {
    await using tmp = await tmpdir()
    const originalHome = process.env.AX_CODE_TEST_HOME
    const originalModel = process.env.ANTHROPIC_MODEL
    process.env.AX_CODE_TEST_HOME = tmp.path
    delete process.env.ANTHROPIC_MODEL
    const settingsDir = path.join(tmp.path, ".claude")
    try {
      await fs.mkdir(settingsDir, { recursive: true })
      await fs.writeFile(path.join(settingsDir, "settings.json"), JSON.stringify({ model: "claude-sonnet-4-6" }))
      await fs.chmod(settingsDir, 0)

      await expect(resolveCliModel("claude-code")).rejects.toMatchObject({ code: "EACCES" })
    } finally {
      await fs.chmod(settingsDir, 0o700).catch(() => undefined)
      if (originalHome !== undefined) process.env.AX_CODE_TEST_HOME = originalHome
      else delete process.env.AX_CODE_TEST_HOME
      if (originalModel !== undefined) process.env.ANTHROPIC_MODEL = originalModel
      else delete process.env.ANTHROPIC_MODEL
    }
  })

  test.skipIf(process.platform === "win32")("codex-cli surfaces config access errors", async () => {
    await using tmp = await tmpdir()
    const originalHome = process.env.AX_CODE_TEST_HOME
    process.env.AX_CODE_TEST_HOME = tmp.path
    const configDir = path.join(tmp.path, ".codex")
    try {
      await fs.mkdir(configDir, { recursive: true })
      await fs.writeFile(path.join(configDir, "config.toml"), 'model = "gpt-5.2-codex"\n')
      await fs.chmod(configDir, 0)

      await expect(resolveCliModel("codex-cli")).rejects.toMatchObject({ code: "EACCES" })
    } finally {
      await fs.chmod(configDir, 0o700).catch(() => undefined)
      if (originalHome !== undefined) process.env.AX_CODE_TEST_HOME = originalHome
      else delete process.env.AX_CODE_TEST_HOME
    }
  })

  test("claude-code respects ANTHROPIC_MODEL env var", async () => {
    const original = process.env.ANTHROPIC_MODEL
    process.env.ANTHROPIC_MODEL = "claude-opus-4-6"
    try {
      const info = await resolveCliModel("claude-code")
      expect(info.model).toBe("claude-opus-4-6")
      expect(info.source).toBe("ANTHROPIC_MODEL")
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_MODEL = original
      else delete process.env.ANTHROPIC_MODEL
    }
  })

  test("claude-code ignores empty or whitespace ANTHROPIC_MODEL env", async () => {
    await using tmp = await tmpdir()
    const originalHome = process.env.AX_CODE_TEST_HOME
    const originalModel = process.env.ANTHROPIC_MODEL
    process.env.AX_CODE_TEST_HOME = tmp.path
    try {
      for (const blank of ["", "   ", "\t"]) {
        process.env.ANTHROPIC_MODEL = blank
        const info = await resolveCliModel("claude-code")
        expect(info).toEqual({ model: "claude-code", source: "default" })
      }
    } finally {
      if (originalHome !== undefined) process.env.AX_CODE_TEST_HOME = originalHome
      else delete process.env.AX_CODE_TEST_HOME
      if (originalModel !== undefined) process.env.ANTHROPIC_MODEL = originalModel
      else delete process.env.ANTHROPIC_MODEL
    }
  })

  test("claude-code ignores empty/whitespace settings model and uses default", async () => {
    await using tmp = await tmpdir()
    const originalHome = process.env.AX_CODE_TEST_HOME
    const originalModel = process.env.ANTHROPIC_MODEL
    process.env.AX_CODE_TEST_HOME = tmp.path
    delete process.env.ANTHROPIC_MODEL
    try {
      const settingsDir = path.join(tmp.path, ".claude")
      await fs.mkdir(settingsDir, { recursive: true })
      await fs.writeFile(path.join(settingsDir, "settings.json"), JSON.stringify({ model: "   " }))

      const info = await resolveCliModel("claude-code")
      expect(info).toEqual({ model: "claude-code", source: "default" })
    } finally {
      if (originalHome !== undefined) process.env.AX_CODE_TEST_HOME = originalHome
      else delete process.env.AX_CODE_TEST_HOME
      if (originalModel !== undefined) process.env.ANTHROPIC_MODEL = originalModel
      else delete process.env.ANTHROPIC_MODEL
    }
  })

  test("claude-code trims settings model and nested model.name", async () => {
    await using tmp = await tmpdir()
    const originalHome = process.env.AX_CODE_TEST_HOME
    const originalModel = process.env.ANTHROPIC_MODEL
    process.env.AX_CODE_TEST_HOME = tmp.path
    delete process.env.ANTHROPIC_MODEL
    try {
      const settingsDir = path.join(tmp.path, ".claude")
      await fs.mkdir(settingsDir, { recursive: true })
      await fs.writeFile(
        path.join(settingsDir, "settings.json"),
        JSON.stringify({ model: { name: "  claude-sonnet-4-6  " } }),
      )

      const info = await resolveCliModel("claude-code")
      expect(info).toEqual({
        model: "claude-sonnet-4-6",
        source: "~/.claude/settings.json",
      })
    } finally {
      if (originalHome !== undefined) process.env.AX_CODE_TEST_HOME = originalHome
      else delete process.env.AX_CODE_TEST_HOME
      if (originalModel !== undefined) process.env.ANTHROPIC_MODEL = originalModel
      else delete process.env.ANTHROPIC_MODEL
    }
  })

  test("returns default for codex-cli when no config", async () => {
    const info = await resolveCliModel("codex-cli")
    if (info.source === "default") {
      expect(info.model).toBe("codex-cli")
    }
  })

  test("returns default for grok-build-cli", async () => {
    const info = await resolveCliModel("grok-build-cli")
    expect(info.model).toBe("grok-build-cli")
    expect(info.source).toBe("default")
  })

  test("does not resolve a Qoder CLI model", async () => {
    const info = await resolveCliModel("qoder-cli")
    expect(info).toEqual({ model: "unknown", source: "none" })
  })

  test("does not resolve a Kimi CLI model", async () => {
    const info = await resolveCliModel("kimi-cli")
    expect(info).toEqual({ model: "unknown", source: "none" })
  })

  async function withMuseEnv(
    values: { home?: string; model?: string | null; xdg?: string | null },
    run: () => Promise<void>,
  ) {
    const originalHome = process.env.AX_CODE_TEST_HOME
    const originalModel = process.env.MUSE_MODEL
    const originalXdg = process.env.XDG_CONFIG_HOME
    if (values.home !== undefined) process.env.AX_CODE_TEST_HOME = values.home
    if (values.model === null) delete process.env.MUSE_MODEL
    else if (values.model !== undefined) process.env.MUSE_MODEL = values.model
    if (values.xdg === null) delete process.env.XDG_CONFIG_HOME
    else if (values.xdg !== undefined) process.env.XDG_CONFIG_HOME = values.xdg
    try {
      await run()
    } finally {
      if (originalHome !== undefined) process.env.AX_CODE_TEST_HOME = originalHome
      else delete process.env.AX_CODE_TEST_HOME
      if (originalModel !== undefined) process.env.MUSE_MODEL = originalModel
      else delete process.env.MUSE_MODEL
      if (originalXdg !== undefined) process.env.XDG_CONFIG_HOME = originalXdg
      else delete process.env.XDG_CONFIG_HOME
    }
  }

  test("returns default for muse-cli when no config", async () => {
    await using tmp = await tmpdir()
    await withMuseEnv({ home: tmp.path, model: null, xdg: null }, async () => {
      const info = await resolveCliModel("muse-cli")
      expect(info).toEqual({ model: "muse-cli", source: "default" })
    })
  })

  test("muse-cli respects MUSE_MODEL env var", async () => {
    await using tmp = await tmpdir()
    await withMuseEnv({ home: tmp.path, model: "muse-spark-1.3", xdg: null }, async () => {
      const info = await resolveCliModel("muse-cli")
      expect(info).toEqual({ model: "muse-spark-1.3", source: "MUSE_MODEL" })
    })
  })

  test("muse-cli reads model from ~/.config/muse/settings.json", async () => {
    await using tmp = await tmpdir()
    await withMuseEnv({ home: tmp.path, model: null, xdg: null }, async () => {
      const configDir = path.join(tmp.path, ".config", "muse")
      await fs.mkdir(configDir, { recursive: true })
      await fs.writeFile(
        path.join(configDir, "settings.json"),
        JSON.stringify({ schema_version: 1, provider: "meta", model: "muse-spark-1.3-contributor" }),
      )

      const info = await resolveCliModel("muse-cli")
      expect(info).toEqual({
        model: "muse-spark-1.3-contributor",
        source: "test-home ~/.config/muse/settings.json",
      })
    })
  })

  test("does not resolve a MiniMax CLI model", async () => {
    const info = await resolveCliModel("minimax-cli")
    expect(info).toEqual({ model: "unknown", source: "none" })
  })

  test("returns unknown for unrecognized provider", async () => {
    const info = await resolveCliModel("nonexistent")
    expect(info.model).toBe("unknown")
    expect(info.source).toBe("none")
  })
})
