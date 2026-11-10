import fs from "node:fs/promises"
import path from "node:path"
import { test, expect, describe } from "vitest"
import { parseCliSettingsJson, resolveCliModel, resolveCodexTomlModel } from "../../../src/provider/cli/resolve"
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

  test("returns default for codex-cli when no config", async () => {
    const info = await resolveCliModel("codex-cli")
    if (info.source === "default") {
      expect(info.model).toBe("codex-cli")
    }
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

  test("codex-cli falls back to its default when only a profile names a model", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, ".codex"), { recursive: true })
    await fs.writeFile(path.join(tmp.path, ".codex", "config.toml"), '[profiles.fast]\nmodel = "gpt-5.5-mini"\n')
    const previous = process.env.AX_CODE_TEST_HOME
    process.env.AX_CODE_TEST_HOME = tmp.path
    try {
      expect(await resolveCliModel("codex-cli")).toEqual({ model: "codex-cli", source: "default" })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_TEST_HOME
      else process.env.AX_CODE_TEST_HOME = previous
    }
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
      const info = await resolveCliModel("minimax-cli")
      expect(info).toEqual({ model: "MiniMax-M3", source: "MCODE_MODEL" })
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

  test("returns unknown for unrecognized provider", async () => {
    const info = await resolveCliModel("nonexistent")
    expect(info.model).toBe("unknown")
    expect(info.source).toBe("none")
  })

  test("returns unknown for retired closed-source CLI providers", async () => {
    for (const providerID of ["claude-code", "muse-cli", "qoder-cli"]) {
      expect(await resolveCliModel(providerID)).toEqual({ model: "unknown", source: "none" })
    }
  })
})
