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

  test("gemini-cli respects GEMINI_MODEL env var", async () => {
    const original = process.env.GEMINI_MODEL
    process.env.GEMINI_MODEL = "gemini-3-flash-preview"
    try {
      const info = await resolveCliModel("gemini-cli")
      expect(info.model).toBe("gemini-3-flash-preview")
      expect(info.source).toBe("GEMINI_MODEL")
    } finally {
      if (original !== undefined) process.env.GEMINI_MODEL = original
      else delete process.env.GEMINI_MODEL
    }
  })

  test("returns default for gemini-cli when no config", async () => {
    const original = process.env.GEMINI_MODEL
    delete process.env.GEMINI_MODEL
    try {
      const info = await resolveCliModel("gemini-cli")
      if (info.source === "default") {
        expect(info.model).toBe("gemini-cli")
      }
    } finally {
      if (original !== undefined) process.env.GEMINI_MODEL = original
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

  test("returns default for qoder-cli when no config", async () => {
    const info = await resolveCliModel("qoder-cli")
    if (info.source === "default") {
      expect(info.model).toBe("qoder-cli")
    }
  })

  test("qoder-cli reads settings from isolated test home", async () => {
    await using tmp = await tmpdir()
    const originalHome = process.env.AX_CODE_TEST_HOME
    const originalModel = process.env.QODER_MODEL
    process.env.AX_CODE_TEST_HOME = tmp.path
    delete process.env.QODER_MODEL
    try {
      const settingsDir = path.join(tmp.path, ".qoder")
      await fs.mkdir(settingsDir, { recursive: true })
      await fs.writeFile(path.join(settingsDir, "settings.json"), JSON.stringify({ model: "qwen3-coder-next" }))

      const info = await resolveCliModel("qoder-cli")
      expect(info).toEqual({
        model: "qwen3-coder-next",
        source: "~/.qoder/settings.json",
      })
    } finally {
      if (originalHome !== undefined) process.env.AX_CODE_TEST_HOME = originalHome
      else delete process.env.AX_CODE_TEST_HOME
      if (originalModel !== undefined) process.env.QODER_MODEL = originalModel
      else delete process.env.QODER_MODEL
    }
  })

  async function withKimiEnv(
    values: {
      home?: string
      model?: string | null
      codeHome?: string | null
      shareDir?: string | null
    },
    run: () => Promise<void>,
  ) {
    const originalHome = process.env.AX_CODE_TEST_HOME
    const originalModel = process.env.KIMI_MODEL
    const originalCodeHome = process.env.KIMI_CODE_HOME
    const originalShareDir = process.env.KIMI_SHARE_DIR
    if (values.home !== undefined) process.env.AX_CODE_TEST_HOME = values.home
    if (values.model === null) delete process.env.KIMI_MODEL
    else if (values.model !== undefined) process.env.KIMI_MODEL = values.model
    if (values.codeHome === null) delete process.env.KIMI_CODE_HOME
    else if (values.codeHome !== undefined) process.env.KIMI_CODE_HOME = values.codeHome
    if (values.shareDir === null) delete process.env.KIMI_SHARE_DIR
    else if (values.shareDir !== undefined) process.env.KIMI_SHARE_DIR = values.shareDir
    try {
      await run()
    } finally {
      if (originalHome !== undefined) process.env.AX_CODE_TEST_HOME = originalHome
      else delete process.env.AX_CODE_TEST_HOME
      if (originalModel !== undefined) process.env.KIMI_MODEL = originalModel
      else delete process.env.KIMI_MODEL
      if (originalCodeHome !== undefined) process.env.KIMI_CODE_HOME = originalCodeHome
      else delete process.env.KIMI_CODE_HOME
      if (originalShareDir !== undefined) process.env.KIMI_SHARE_DIR = originalShareDir
      else delete process.env.KIMI_SHARE_DIR
    }
  }

  test("returns default for kimi-cli when no config", async () => {
    await using tmp = await tmpdir()
    await withKimiEnv({ home: tmp.path, model: null, codeHome: null, shareDir: null }, async () => {
      const info = await resolveCliModel("kimi-cli")
      expect(info).toEqual({ model: "kimi-cli", source: "default" })
    })
  })

  test("kimi-cli respects KIMI_MODEL env var", async () => {
    await withKimiEnv({ model: "kimi-code/k3", codeHome: null, shareDir: null }, async () => {
      const info = await resolveCliModel("kimi-cli")
      expect(info).toEqual({ model: "kimi-code/k3", source: "KIMI_MODEL" })
    })
  })

  test("kimi-cli reads default_model from ~/.kimi-code/config.toml", async () => {
    await using tmp = await tmpdir()
    await withKimiEnv({ home: tmp.path, model: null, codeHome: null, shareDir: null }, async () => {
      const configDir = path.join(tmp.path, ".kimi-code")
      await fs.mkdir(configDir, { recursive: true })
      await fs.writeFile(path.join(configDir, "config.toml"), 'default_model = "kimi-code/kimi-for-coding"\n')

      const info = await resolveCliModel("kimi-cli")
      expect(info).toEqual({
        model: "kimi-code/kimi-for-coding",
        source: "~/.kimi-code/config.toml",
      })
    })
  })

  test("kimi-cli prefers ~/.kimi-code over legacy ~/.kimi", async () => {
    await using tmp = await tmpdir()
    await withKimiEnv({ home: tmp.path, model: null, codeHome: null, shareDir: null }, async () => {
      const codeDir = path.join(tmp.path, ".kimi-code")
      const legacyDir = path.join(tmp.path, ".kimi")
      await fs.mkdir(codeDir, { recursive: true })
      await fs.mkdir(legacyDir, { recursive: true })
      await fs.writeFile(path.join(codeDir, "config.toml"), 'default_model = "kimi-code/k3"\n')
      await fs.writeFile(path.join(legacyDir, "config.toml"), 'default_model = "legacy-model"\n')

      const info = await resolveCliModel("kimi-cli")
      expect(info).toEqual({
        model: "kimi-code/k3",
        source: "~/.kimi-code/config.toml",
      })
    })
  })

  test("kimi-cli falls back to legacy ~/.kimi/config.toml", async () => {
    await using tmp = await tmpdir()
    await withKimiEnv({ home: tmp.path, model: null, codeHome: null, shareDir: null }, async () => {
      const configDir = path.join(tmp.path, ".kimi")
      await fs.mkdir(configDir, { recursive: true })
      await fs.writeFile(path.join(configDir, "config.toml"), 'default_model = "kimi-for-coding"\n')

      const info = await resolveCliModel("kimi-cli")
      expect(info).toEqual({
        model: "kimi-for-coding",
        source: "~/.kimi/config.toml",
      })
    })
  })

  test("kimi-cli respects KIMI_CODE_HOME", async () => {
    await using tmp = await tmpdir()
    await withKimiEnv({ model: null, codeHome: tmp.path, shareDir: null }, async () => {
      await fs.writeFile(path.join(tmp.path, "config.toml"), 'default_model = "kimi-code/k3"\n')

      const info = await resolveCliModel("kimi-cli")
      expect(info).toEqual({
        model: "kimi-code/k3",
        source: "$KIMI_CODE_HOME/config.toml",
      })
    })
  })

  test("kimi-cli respects a custom KIMI_SHARE_DIR", async () => {
    await using tmp = await tmpdir()
    await withKimiEnv({ model: null, codeHome: null, shareDir: tmp.path }, async () => {
      await fs.writeFile(path.join(tmp.path, "config.toml"), 'default_model = "kimi-for-coding"\n')

      const info = await resolveCliModel("kimi-cli")
      expect(info).toEqual({
        model: "kimi-for-coding",
        source: "$KIMI_SHARE_DIR/config.toml",
      })
    })
  })

  test("kimi-cli accepts indented and single-quoted default_model", async () => {
    await using tmp = await tmpdir()
    await withKimiEnv({ home: tmp.path, model: null, codeHome: null, shareDir: null }, async () => {
      const configDir = path.join(tmp.path, ".kimi-code")
      await fs.mkdir(configDir, { recursive: true })
      await fs.writeFile(path.join(configDir, "config.toml"), "  default_model = 'kimi-code/k3'\n")

      const info = await resolveCliModel("kimi-cli")
      expect(info).toEqual({
        model: "kimi-code/k3",
        source: "~/.kimi-code/config.toml",
      })
    })
  })

  test("returns unknown for unrecognized provider", async () => {
    const info = await resolveCliModel("nonexistent")
    expect(info.model).toBe("unknown")
    expect(info.source).toBe("none")
  })
})
