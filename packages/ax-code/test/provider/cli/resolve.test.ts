import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, test, expect, describe, vi } from "vitest"
import { parseCliSettingsJson, resolveCliModel, resolveCodexTomlModel } from "../../../src/provider/cli/resolve"
import { tmpdir } from "../../fixture/fixture"

afterEach(() => vi.unstubAllEnvs())

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

  async function withMiniMaxEnv(
    values: { home?: string; model?: string | null; dataDir?: string | null },
    run: () => Promise<void>,
  ) {
    const originalHome = process.env.AX_CODE_TEST_HOME
    const originalModel = process.env.MCODE_MODEL
    const originalDataDir = process.env.MINIMAX_DATA_DIR
    const originalMavis = process.env.MAVIS_DATA_DIR
    if (values.home !== undefined) process.env.AX_CODE_TEST_HOME = values.home
    if (values.model === null) delete process.env.MCODE_MODEL
    else if (values.model !== undefined) process.env.MCODE_MODEL = values.model
    if (values.dataDir === null) delete process.env.MINIMAX_DATA_DIR
    else if (values.dataDir !== undefined) process.env.MINIMAX_DATA_DIR = values.dataDir
    delete process.env.MAVIS_DATA_DIR
    try {
      await run()
    } finally {
      if (originalHome !== undefined) process.env.AX_CODE_TEST_HOME = originalHome
      else delete process.env.AX_CODE_TEST_HOME
      if (originalModel !== undefined) process.env.MCODE_MODEL = originalModel
      else delete process.env.MCODE_MODEL
      if (originalDataDir !== undefined) process.env.MINIMAX_DATA_DIR = originalDataDir
      else delete process.env.MINIMAX_DATA_DIR
      if (originalMavis !== undefined) process.env.MAVIS_DATA_DIR = originalMavis
      else delete process.env.MAVIS_DATA_DIR
    }
  }

  test("returns default for minimax-cli when no config", async () => {
    await using tmp = await tmpdir()
    await withMiniMaxEnv({ home: tmp.path, model: null, dataDir: null }, async () => {
      const info = await resolveCliModel("minimax-cli")
      expect(info).toEqual({ model: "minimax-cli", source: "default" })
    })
  })

  test("minimax-cli respects MCODE_MODEL env var", async () => {
    await using tmp = await tmpdir()
    await withMiniMaxEnv({ home: tmp.path, model: "MiniMax-M3", dataDir: null }, async () => {
      await fs.mkdir(path.join(tmp.path, ".minimax"))
      await fs.writeFile(path.join(tmp.path, ".minimax", "config.yaml"), "defaultModel: [broken")
      const info = await resolveCliModel("minimax-cli")
      expect(info).toEqual({ model: "MiniMax-M3", source: "MCODE_MODEL" })
    })
  })

  test.each(["MINIMAX_DATA_DIR", "MAVIS_DATA_DIR"])("minimax-cli reads YAML from %s", async (envName) => {
    await using tmp = await tmpdir()
    vi.stubEnv("AX_CODE_TEST_HOME", undefined)
    vi.stubEnv("MCODE_MODEL", undefined)
    vi.stubEnv("MINIMAX_DATA_DIR", envName === "MINIMAX_DATA_DIR" ? tmp.path : undefined)
    vi.stubEnv("MAVIS_DATA_DIR", path.join(tmp.path, "legacy"))
    await fs.mkdir(path.join(tmp.path, "legacy"))
    await fs.writeFile(path.join(tmp.path, "config.yaml"), '"defaultModel": "minimax_oauth/MiniMax-M3"')
    await fs.writeFile(path.join(tmp.path, "legacy", "config.yaml"), "defaultModel: legacy-model")

    expect(await resolveCliModel("minimax-cli")).toEqual({
      model: envName === "MINIMAX_DATA_DIR" ? "minimax_oauth/MiniMax-M3" : "legacy-model",
      source: `$${envName}/config.yaml`,
    })
  })

  test("minimax-cli reads defaultModel from ~/.minimax/config.yaml", async () => {
    await using tmp = await tmpdir()
    await withMiniMaxEnv({ home: tmp.path, model: null, dataDir: null }, async () => {
      const configDir = path.join(tmp.path, ".minimax")
      await fs.mkdir(configDir, { recursive: true })
      await fs.writeFile(path.join(configDir, "config.yaml"), 'defaultModel: "minimax_oauth/MiniMax-M3"\n')

      const info = await resolveCliModel("minimax-cli")
      expect(info).toEqual({
        model: "minimax_oauth/MiniMax-M3",
        source: "test-home ~/.minimax/config.yaml",
      })
    })
  })

  test.each([
    ["plain scalar and comment", "defaultModel: minimax_oauth/MiniMax-M3 # selected model"],
    ["single-quoted scalar", "defaultModel: 'minimax_oauth/MiniMax-M3'"],
    ["quoted key", '"defaultModel": "minimax_oauth/MiniMax-M3"'],
    ["flow mapping", '{ "defaultModel": "minimax_oauth/MiniMax-M3" }'],
    ["escaped scalar", 'defaultModel: "minimax_oauth\\u002fMiniMax-M3"'],
    ["block scalar", "defaultModel: >-\n  minimax_oauth/MiniMax-M3\n"],
    [
      "nested default before the root default",
      "profiles:\n  example:\n    defaultModel: example-model\ndefaultModel: minimax_oauth/MiniMax-M3",
    ],
    [
      "model-looking text in a block scalar",
      "instructions: |\n  defaultModel: example-model\ndefaultModel: minimax_oauth/MiniMax-M3",
    ],
    ["scalar alias", "selected: &selected minimax_oauth/MiniMax-M3\ndefaultModel: *selected"],
  ])("minimax-cli parses YAML with %s", async (_name, yaml) => {
    await using tmp = await tmpdir()
    await withMiniMaxEnv({ home: tmp.path, model: null, dataDir: null }, async () => {
      const configDir = path.join(tmp.path, ".minimax")
      await fs.mkdir(configDir)
      await fs.writeFile(path.join(configDir, "config.yaml"), yaml)

      expect(await resolveCliModel("minimax-cli")).toEqual({
        model: "minimax_oauth/MiniMax-M3",
        source: "test-home ~/.minimax/config.yaml",
      })
    })
  })

  test.each([
    "defaultModel:\ntheme: dark",
    "defaultModel: null",
    "defaultModel: ~",
    "defaultModel: false",
    "defaultModel: 42",
    'defaultModel: ""',
    'defaultModel: "   "',
    "defaultModel: []",
    "defaultModel: [example-model]",
    "defaultModel: { id: example-model }",
    "profiles:\n  example:\n    defaultModel: example-model",
    "instructions: |\n  defaultModel: example-model",
    "defaultModel: first-model\ndefaultModel: second-model",
    "defaultModel: example-model\nbroken: [",
    "defaultModel: example-model\n---\ndefaultModel: second-model",
    "defaultModel: *missing",
    "- defaultModel: example-model",
    "null",
    "example-model",
    "__proto__:\n  defaultModel: example-model",
  ])("minimax-cli falls back to its default for config %s", async (yaml) => {
    await using tmp = await tmpdir()
    await withMiniMaxEnv({ home: tmp.path, model: null, dataDir: null }, async () => {
      const configDir = path.join(tmp.path, ".minimax")
      await fs.mkdir(configDir)
      await fs.writeFile(path.join(configDir, "config.yaml"), yaml)

      expect(await resolveCliModel("minimax-cli")).toEqual({ model: "minimax-cli", source: "default" })
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

  test("returns unknown for retired closed-source CLI providers", async () => {
    for (const providerID of ["claude-code", "muse-cli", "qoder-cli"]) {
      expect(await resolveCliModel(providerID)).toEqual({ model: "unknown", source: "none" })
    }
  })
})
