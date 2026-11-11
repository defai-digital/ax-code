import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, test, expect, describe, vi } from "vitest"
import {
  parseCliSettingsJson,
  resolveCliModel,
  resolveCodexTomlModel,
  resolveKimiConfigModels,
} from "../../../src/provider/cli/resolve"
import { tmpdir } from "../../fixture/fixture"

afterEach(() => vi.unstubAllEnvs())
// Keep Claude settings lookups isolated from a developer's real CLAUDE_CONFIG_DIR.
beforeEach(() => vi.stubEnv("CLAUDE_CONFIG_DIR", undefined))

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
    await using tmp = await tmpdir()
    vi.stubEnv("AX_CODE_TEST_HOME", tmp.path)
    vi.stubEnv("ANTHROPIC_MODEL", undefined)
    vi.stubEnv("CLAUDE_CONFIG_DIR", undefined)

    expect(await resolveCliModel("claude-code")).toEqual({ model: "claude-code", source: "default" })
  })

  test("claude-code reads settings from CLAUDE_CONFIG_DIR", async () => {
    await using config = await tmpdir()
    // The test-home override wins over CLAUDE_CONFIG_DIR (as for CODEX_HOME), so
    // clear it to exercise the real lookup order.
    vi.stubEnv("AX_CODE_TEST_HOME", undefined)
    vi.stubEnv("ANTHROPIC_MODEL", undefined)
    vi.stubEnv("CLAUDE_CONFIG_DIR", config.path)

    await fs.writeFile(path.join(config.path, "settings.json"), JSON.stringify({ model: "config-dir-model" }))

    expect(await resolveCliModel("claude-code")).toEqual({
      model: "config-dir-model",
      source: "$CLAUDE_CONFIG_DIR/settings.json",
    })
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
    await using tmp = await tmpdir()
    vi.stubEnv("AX_CODE_TEST_HOME", tmp.path)
    expect(await resolveCliModel("codex-cli")).toEqual({ model: "codex-cli", source: "default" })
  })

  test("reads only the top-level Codex model, not a profile's", () => {
    expect(resolveCodexTomlModel('model = "gpt-5.5"\n[profiles.fast]\nmodel = "gpt-5.5-mini"\n')).toBe("gpt-5.5")
    // Regression: a profile-only model was read as the Codex default.
    expect(resolveCodexTomlModel('approval_policy = "never"\n\n[profiles.fast]\nmodel = "gpt-5.5-mini"\n')).toBe(
      undefined,
    )
    expect(resolveCodexTomlModel('[model_providers.local]\nname = "Local"\nmodel = "x"\n')).toBeUndefined()
    expect(resolveCodexTomlModel("  model = 'gpt-5.5'\n")).toBe("gpt-5.5")
    expect(resolveCodexTomlModel('model_reasoning_effort = "high"\n')).toBeUndefined()
  })

  test.each([
    [
      "model-looking text in a multiline string",
      `instructions = '''\nmodel = "example-model"\n'''\nmodel = "actual-model"`,
    ],
    ["table-looking text in a multiline string", `instructions = """\n[profiles.example]\n"""\nmodel = "actual-model"`],
    ["quoted keys", '"model" = "actual-model"'],
    ["escaped model strings", 'model = "actual\\u002dmodel"'],
    ["multiline model strings", 'model = """actual-model"""'],
    ["nested arrays before the model", 'examples = [\n["example-model"],\n]\nmodel = "actual-model"'],
  ])("parses Codex TOML with %s", (_name, toml) => {
    expect(resolveCodexTomlModel(toml)).toBe("actual-model")
  })

  test.each([
    `instructions = '''\nmodel = "example-model"\n'''`,
    'model = "actual-model"\ninvalid = [',
    'model = "first"\nmodel = "second"',
    'model.name = "example-model"',
    'model = ["example-model"]',
    "model = 42",
    'model = "   "',
  ])("does not resolve an invalid or missing top-level model from %s", (toml) => {
    expect(resolveCodexTomlModel(toml)).toBeUndefined()
  })

  test("codex-cli reads config from CODEX_HOME", async () => {
    await using tmp = await tmpdir()
    vi.stubEnv("AX_CODE_TEST_HOME", undefined)
    vi.stubEnv("CODEX_HOME", tmp.path)
    await fs.writeFile(path.join(tmp.path, "config.toml"), 'model = "custom-codex-model"\n')

    expect(await resolveCliModel("codex-cli")).toEqual({
      model: "custom-codex-model",
      source: "$CODEX_HOME/config.toml",
    })
  })

  test("codex-cli test home takes precedence over CODEX_HOME", async () => {
    await using tmp = await tmpdir()
    vi.stubEnv("AX_CODE_TEST_HOME", tmp.path)
    vi.stubEnv("CODEX_HOME", path.join(tmp.path, "other-codex"))
    await fs.mkdir(path.join(tmp.path, ".codex"))
    await fs.mkdir(path.join(tmp.path, "other-codex"))
    await fs.writeFile(path.join(tmp.path, ".codex", "config.toml"), 'model = "isolated-model"\n')
    await fs.writeFile(path.join(tmp.path, "other-codex", "config.toml"), 'model = "other-model"\n')

    expect(await resolveCliModel("codex-cli")).toEqual({ model: "isolated-model", source: "~/.codex/config.toml" })
  })

  test.each([
    '[profiles.fast]\nmodel = "gpt-5.5-mini"\n',
    `instructions = '''\nmodel = "example-model"\n'''`,
    'model = "example-model"\ninvalid = [',
    'model = ""',
  ])("codex-cli falls back to its default for config %s", async (toml) => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, ".codex"), { recursive: true })
    await fs.writeFile(path.join(tmp.path, ".codex", "config.toml"), toml)
    vi.stubEnv("AX_CODE_TEST_HOME", tmp.path)
    expect(await resolveCliModel("codex-cli")).toEqual({ model: "codex-cli", source: "default" })
  })

  test("returns default for grok-build-cli", async () => {
    const info = await resolveCliModel("grok-build-cli")
    expect(info.model).toBe("grok-build-cli")
    expect(info.source).toBe("default")
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

  test("kimi-cli normalizes known legacy KIMI_MODEL aliases", async () => {
    await withKimiEnv({ model: "k3", codeHome: null, shareDir: null }, async () => {
      const info = await resolveCliModel("kimi-cli")
      expect(info).toEqual({ model: "kimi-code/k3", source: "KIMI_MODEL" })
    })
  })

  test("kimi-cli preserves custom unqualified model aliases", async () => {
    await withKimiEnv({ model: "team-model", codeHome: null, shareDir: null }, async () => {
      const info = await resolveCliModel("kimi-cli")
      expect(info).toEqual({ model: "team-model", source: "KIMI_MODEL" })
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
        model: "kimi-code/kimi-for-coding",
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
        model: "kimi-code/kimi-for-coding",
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

  test.each([
    [
      "prompt examples",
      `prompt = '''\ndefault_model = "example-model"\n'''\ndefault_model = "kimi-code/k3"`,
      "kimi-code/k3",
    ],
    ["nested defaults", '[models.example]\ndefault_model = "example-model"', "kimi-cli"],
    ["quoted keys and escapes", '"default_model" = "kimi-code\\u002fk3"', "kimi-code/k3"],
    ["invalid TOML", 'default_model = "example-model"\ninvalid = [', "kimi-cli"],
  ])("kimi-cli resolves TOML with %s", async (_name, toml, model) => {
    await using tmp = await tmpdir()
    await withKimiEnv({ home: tmp.path, model: null, codeHome: null, shareDir: null }, async () => {
      const configDir = path.join(tmp.path, ".kimi-code")
      await fs.mkdir(configDir)
      await fs.writeFile(path.join(configDir, "config.toml"), toml)

      expect(await resolveCliModel("kimi-cli")).toEqual({
        model,
        source: model === "kimi-cli" ? "default" : "~/.kimi-code/config.toml",
      })
    })
  })

  test("kimi-cli offers the model aliases declared in config.toml", async () => {
    await using tmp = await tmpdir()
    await withKimiEnv({ home: tmp.path, model: null, codeHome: null, shareDir: null }, async () => {
      const configDir = path.join(tmp.path, ".kimi-code")
      await fs.mkdir(configDir, { recursive: true })
      await fs.writeFile(
        path.join(configDir, "config.toml"),
        [
          'default_model = "kimi-code/k3.1-pro"',
          "",
          '[models."kimi-code/kimi-for-coding"]',
          'label = "K2.7 Coding"',
          "",
          '[models."kimi-code/k3.1-pro"]',
          'label = "K3.1 Pro"',
          "",
        ].join("\n"),
      )

      expect(await resolveKimiConfigModels()).toEqual({
        source: "~/.kimi-code/config.toml",
        defaultModel: "kimi-code/k3.1-pro",
        aliases: ["kimi-code/kimi-for-coding", "kimi-code/k3.1-pro"],
      })
      // The default model still resolves to the alias.
      expect(await resolveCliModel("kimi-cli")).toEqual({
        model: "kimi-code/k3.1-pro",
        source: "~/.kimi-code/config.toml",
      })
    })
  })

  test("kimi-cli reads aliases only from an explicit home override", async () => {
    await using tmp = await tmpdir()
    await using other = await tmpdir()
    const override = path.join(tmp.path, "override")
    await fs.mkdir(override, { recursive: true })
    await fs.writeFile(path.join(override, "config.toml"), ['[models."kimi-code/k3"]', 'label = "K3"', ""].join("\n"))
    // A default-home config must not be merged when an override is set.
    await fs.mkdir(path.join(other.path, ".kimi-code"), { recursive: true })
    await fs.writeFile(path.join(other.path, ".kimi-code", "config.toml"), 'default_model = "home-model"\n')

    await withKimiEnv({ home: other.path, model: null, codeHome: override, shareDir: null }, async () => {
      expect(await resolveKimiConfigModels()).toEqual({
        source: "$KIMI_CODE_HOME/config.toml",
        defaultModel: undefined,
        aliases: ["kimi-code/k3"],
      })
    })
  })

  test("kimi-cli does not fall through to the default home when an override has no model", async () => {
    await using tmp = await tmpdir()
    await using other = await tmpdir()
    const override = path.join(tmp.path, "override")
    await fs.mkdir(override, { recursive: true })
    await fs.writeFile(path.join(override, "config.toml"), 'theme = "dark"\n')
    await fs.mkdir(path.join(other.path, ".kimi-code"), { recursive: true })
    await fs.writeFile(path.join(other.path, ".kimi-code", "config.toml"), 'default_model = "home-model"\n')

    await withKimiEnv({ home: other.path, model: null, codeHome: override, shareDir: null }, async () => {
      expect(await resolveKimiConfigModels()).toBeUndefined()
      expect(await resolveCliModel("kimi-cli")).toEqual({ model: "kimi-cli", source: "default" })
    })
  })

  test("kimi-cli tries the legacy config after a malformed current config", async () => {
    await using tmp = await tmpdir()
    await withKimiEnv({ home: tmp.path, model: null, codeHome: null, shareDir: null }, async () => {
      await fs.mkdir(path.join(tmp.path, ".kimi-code"))
      await fs.mkdir(path.join(tmp.path, ".kimi"))
      await fs.writeFile(
        path.join(tmp.path, ".kimi-code", "config.toml"),
        'default_model = "broken-model"\ninvalid = [',
      )
      await fs.writeFile(path.join(tmp.path, ".kimi", "config.toml"), 'default_model = "k3"')

      expect(await resolveCliModel("kimi-cli")).toEqual({
        model: "kimi-code/k3",
        source: "~/.kimi/config.toml",
      })
    })
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

  test("returns unknown for unrecognized provider", async () => {
    const info = await resolveCliModel("nonexistent")
    expect(info.model).toBe("unknown")
    expect(info.source).toBe("none")
  })

  test.each(["constructor", "toString", "hasOwnProperty", "__proto__"])(
    "returns unknown for inherited provider name %s",
    async (providerID) => {
      expect(await resolveCliModel(providerID)).toEqual({ model: "unknown", source: "none" })
    },
  )

  test("returns unknown for retired CLI providers", async () => {
    expect(await resolveCliModel("qoder-cli")).toEqual({ model: "unknown", source: "none" })
  })
})
