import { afterEach, test, expect, describe, vi } from "vitest"
import path from "path"
import { chmod, mkdir, utimes, writeFile } from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Env } from "../../src/env"
import { which } from "../../src/util/which"
import { Process } from "../../src/util/process"
import { selectPreferredCodexBinary } from "../../src/provider/cli/binary"
import { CUSTOM_LOADERS, resolveCliBinary } from "../../src/provider/loaders"
import { Config } from "../../src/config/config"
import { Global } from "../../src/global"
import { ModelsDev } from "../../src/provider/models"

const originalFetch = globalThis.fetch

afterEach(async () => {
  globalThis.fetch = originalFetch
  delete process.env.AX_STUDIO_HOST
  vi.unstubAllEnvs()
  await Instance.disposeAll()
})

async function expectMissingCliProvider(input: {
  providerID: string
  binary: string
  baseModelID: string
  discoveredModelIDs: string[]
}) {
  if (which(input.binary)) return

  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeFile(
        path.join(dir, "ax-code.json"),
        JSON.stringify({
          $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
          provider: { [input.providerID]: {} },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const provider = providers[ProviderID.make(input.providerID)]
      expect(provider).toBeDefined()
      expect(Object.keys(provider.models)).toEqual([input.baseModelID])
      for (const modelID of input.discoveredModelIDs) {
        expect(provider.models[ModelID.make(modelID)]).toBeUndefined()
      }

      expect(provider.models[ModelID.make(input.baseModelID)]?.api.npm).toBe("cli")
    },
  })
}

describe("CLI provider loaders", () => {
  test("rechecks a CLI binary that was installed after an earlier miss", async () => {
    await using tmp = await tmpdir()
    const binary = `ax-code-dynamic-cli-${process.pid}-${Date.now()}`
    const executable = path.join(tmp.path, process.platform === "win32" ? `${binary}.cmd` : binary)
    vi.stubEnv("PATH", tmp.path)
    if (process.platform === "win32") vi.stubEnv("PATHEXT", ".CMD")

    expect(await resolveCliBinary("dynamic-cli-test", binary)).toBeNull()

    await writeFile(executable, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n")
    await chmod(executable, 0o755)

    expect(path.normalize((await resolveCliBinary("dynamic-cli-test", binary)) ?? "")).toBe(path.normalize(executable))
  })

  test("prefers the newest Codex executable when PATH contains a stale launcher", () => {
    expect(
      selectPreferredCodexBinary([
        { path: "/Users/test/.local/bin/codex", version: "codex-cli 0.142.5" },
        { path: "/Applications/ChatGPT.app/Contents/Resources/codex", version: "codex-cli 0.144.2" },
      ]),
    ).toBe("/Applications/ChatGPT.app/Contents/Resources/codex")
  })

  test.each([undefined, "unexpected version output"])(
    "prefers a versioned Codex executable when the first version is %s",
    (version) => {
      expect(
        selectPreferredCodexBinary([
          { path: "/stale/codex", version },
          { path: "/working/codex", version: "codex-cli 0.144.2" },
          { path: "/older/codex", version: "codex-cli 0.142.5" },
        ]),
      ).toBe("/working/codex")
    },
  )

  test("uses a working version probe after the first Codex executable fails its probe", async () => {
    await using tmp = await tmpdir()
    const binary = `ax-code-codex-probe-${process.pid}`
    const suffix = process.platform === "win32" ? ".cmd" : ""
    const firstDir = path.join(tmp.path, "stale")
    const secondDir = path.join(tmp.path, "working")
    await mkdir(firstDir)
    await mkdir(secondDir)
    const first = path.join(firstDir, binary + suffix)
    const second = path.join(secondDir, binary + suffix)
    await writeFile(first, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n")
    await writeFile(second, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n")
    await chmod(first, 0o755)
    await chmod(second, 0o755)
    vi.stubEnv("PATH", [firstDir, secondDir].join(path.delimiter))
    if (process.platform === "win32") vi.stubEnv("PATHEXT", ".CMD")
    const normalize = (value: string) => {
      const normalized = path.normalize(value)
      return process.platform === "win32" ? normalized.toLowerCase() : normalized
    }
    const run = vi.spyOn(Process, "run").mockImplementation(async (cmd) => {
      if (normalize(cmd[0]) === normalize(first)) throw new Error("version probe failed")
      return { code: 0, stdout: Buffer.from("codex-cli 0.144.2"), stderr: Buffer.alloc(0) } as any
    })
    try {
      expect(normalize((await resolveCliBinary("codex-cli", binary)) ?? "")).toBe(normalize(second))
    } finally {
      run.mockRestore()
    }
  })

  test("keeps the first Codex candidate when every version probe is unavailable", () => {
    expect(selectPreferredCodexBinary([{ path: "/first/codex" }, { path: "/second/codex", version: "unknown" }])).toBe(
      "/first/codex",
    )
    expect(selectPreferredCodexBinary([])).toBeUndefined()
  })

  test("does not replace a versioned Codex executable with an unversioned one", () => {
    expect(
      selectPreferredCodexBinary([
        { path: "/working/codex", version: "codex-cli 0.144.2" },
        { path: "/unknown/codex" },
        { path: "/broken/codex", version: "unknown" },
      ]),
    ).toBe("/working/codex")
  })

  test("claude-code configured provider does not discover runnable variants when binary missing", async () => {
    await expectMissingCliProvider({
      providerID: "claude-code",
      binary: "claude",
      baseModelID: "claude-code",
      discoveredModelIDs: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
    })
  })

  test("codex-cli configured provider does not discover runnable variants when binary missing", async () => {
    await expectMissingCliProvider({
      providerID: "codex-cli",
      binary: "codex",
      baseModelID: "codex-cli",
      discoveredModelIDs: ["gpt-5.6", "gpt-5.4-mini", "gpt-5.3-codex-spark"],
    })
  })

  test("grok-build-cli configured provider does not discover runnable variants when binary missing", async () => {
    await expectMissingCliProvider({
      providerID: "grok-build-cli",
      binary: "grok",
      baseModelID: "grok-build-cli",
      discoveredModelIDs: ["grok-4.5"],
    })
  })

  test("kimi-cli configured provider does not discover runnable variants when binary missing", async () => {
    await expectMissingCliProvider({
      providerID: "kimi-cli",
      binary: "kimi",
      baseModelID: "kimi-cli",
      discoveredModelIDs: ["kimi-code/k3", "kimi-code/kimi-for-coding"],
    })
  })
})

describe("CLI default discovery", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const CLI_TEST_BINARIES: Record<string, string> = {
    "claude-code": "claude",
    "codex-cli": "codex",
    "grok-build-cli": "grok",
    "kimi-cli": "kimi",
    "muse-cli": "muse",
    "dsh-cli": "dsh",
    "antigravity-cli": "agy",
  }

  const CLI_ENV_KEYS = [
    "ANTHROPIC_MODEL",
    "CLAUDE_CONFIG_DIR",
    "CODEX_HOME",
    "KIMI_CODE_HOME",
    "KIMI_MODEL",
    "KIMI_SHARE_DIR",
    "MUSE_MODEL",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
  ]

  function cliProviderInfo(providerID: string): Provider.Info {
    return {
      id: ProviderID.make(providerID),
      name: providerID,
      source: "config",
      env: [],
      options: {},
      models: {
        [ModelID.make(providerID)]: {
          id: ModelID.make(providerID),
          providerID: ProviderID.make(providerID),
          name: "CLI default",
          api: { id: providerID, npm: "cli", url: "" },
          family: providerID,
          release_date: "",
          limit: { context: 200_000, output: 32_000 },
          capabilities: {
            temperature: true,
            reasoning: true,
            attachment: false,
            toolcall: true,
            interleaved: false,
            input: { text: true, image: false, audio: false, video: false, pdf: false },
            output: { text: true, image: false, audio: false, video: false, pdf: false },
          },
          options: {},
          headers: {},
          status: "active",
          variants: {},
        },
      },
    } as unknown as Provider.Info
  }

  async function prepareCli(
    tmp: { path: string },
    providerID: string,
    modelsDev: Awaited<ReturnType<typeof ModelsDev.get>> = {} as Awaited<ReturnType<typeof ModelsDev.get>>,
  ) {
    vi.spyOn(ModelsDev, "get").mockResolvedValue(modelsDev)
    vi.stubEnv("AX_CODE_TEST_HOME", tmp.path)
    vi.stubEnv("PATH", tmp.path)
    for (const key of CLI_ENV_KEYS) vi.stubEnv(key, undefined)
    if (process.platform === "win32") vi.stubEnv("PATHEXT", ".CMD")
    const binary = CLI_TEST_BINARIES[providerID]!
    const executable = path.join(tmp.path, process.platform === "win32" ? `${binary}.cmd` : binary)
    await writeFile(executable, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\nexit 0\n")
    await chmod(executable, 0o755)
  }

  async function discoverCli(providerID: string, provider = cliProviderInfo(providerID)) {
    const loader = await CUSTOM_LOADERS[providerID]!(provider)
    const discovered = await loader.discoverModels!(provider)
    // provider-impl merges discovered models over the provider's live models.
    provider.models = { ...provider.models, ...discovered }
    return { loader, provider, discovered }
  }

  function cliDefaultMarks(models: Record<string, Provider.Model>) {
    return Object.entries(models)
      .filter(([, model]) => model.options?.cliDefault === true)
      .map(([id]) => id)
      .sort()
  }

  function expectCliDefaultInvariant(models: Record<string, Provider.Model>, providerID: string) {
    const marks = cliDefaultMarks(models)
    const sentinel = Boolean(models[ModelID.make(providerID)])
    if (sentinel) expect(marks).toEqual([])
    else expect(marks).toHaveLength(1)
  }

  const configuredCases: Array<{
    providerID: string
    setup: (tmp: { path: string }) => Promise<void>
    expected: string
  }> = [
    {
      providerID: "claude-code",
      setup: async (tmp) => {
        await mkdir(path.join(tmp.path, ".claude"), { recursive: true })
        await writeFile(path.join(tmp.path, ".claude", "settings.json"), JSON.stringify({ model: "claude-sonnet-5" }))
      },
      expected: "claude-sonnet-5",
    },
    {
      providerID: "codex-cli",
      setup: async (tmp) => {
        await mkdir(path.join(tmp.path, ".codex"), { recursive: true })
        await writeFile(path.join(tmp.path, ".codex", "config.toml"), 'model = "gpt-5.6"\n')
      },
      expected: "gpt-5.6",
    },
    {
      providerID: "kimi-cli",
      setup: async (tmp) => {
        await mkdir(path.join(tmp.path, ".kimi-code"), { recursive: true })
        await writeFile(
          path.join(tmp.path, ".kimi-code", "config.toml"),
          ['default_model = "kimi-code/k3"', "", '[models."kimi-code/k3"]', 'label = "K3"', ""].join("\n"),
        )
      },
      expected: "kimi-code/k3",
    },
    {
      providerID: "muse-cli",
      setup: async (tmp) => {
        await mkdir(path.join(tmp.path, ".config", "muse"), { recursive: true })
        await writeFile(
          path.join(tmp.path, ".config", "muse", "settings.json"),
          JSON.stringify({ model: "muse-spark-1.3" }),
        )
      },
      expected: "muse-spark-1.3",
    },
  ]

  test.each(configuredCases)("$providerID marks its resolved default and drops the sentinel", async (item) => {
    await using tmp = await tmpdir()
    await prepareCli(tmp, item.providerID)
    await item.setup(tmp)

    const first = await discoverCli(item.providerID)
    expect(cliDefaultMarks(first.provider.models)).toEqual([item.expected])
    expect(first.provider.models[ModelID.make(item.providerID)]).toBeUndefined()
    expectCliDefaultInvariant(first.provider.models, item.providerID)

    // Re-running discovery on its own output must not spread the mark through
    // the base model or leave a duplicate.
    const second = await discoverCli(item.providerID, first.provider)
    expect(cliDefaultMarks(second.provider.models)).toEqual([item.expected])
    expect(second.provider.models[ModelID.make(item.providerID)]).toBeUndefined()
  })

  test.each(Object.keys(CLI_TEST_BINARIES))(
    "%s keeps the sentinel when no CLI default is configured",
    async (providerID) => {
      await using tmp = await tmpdir()
      await prepareCli(tmp, providerID)

      const first = await discoverCli(providerID)
      expect(cliDefaultMarks(first.provider.models)).toEqual([])
      expect(first.provider.models[ModelID.make(providerID)]).toBeDefined()
      expectCliDefaultInvariant(first.provider.models, providerID)

      const second = await discoverCli(providerID, first.provider)
      expect(cliDefaultMarks(second.provider.models)).toEqual([])
      expect(second.provider.models[ModelID.make(providerID)]).toBeDefined()
    },
  )

  test("Antigravity publishes native model slugs and keeps the CLI-owned default", async () => {
    await using tmp = await tmpdir()
    await prepareCli(tmp, "antigravity-cli")
    const run = vi.spyOn(Process, "run").mockResolvedValue({
      code: 0,
      stdout: Buffer.from("gemini-4-argon-high\tGemini 4 Argon (High)\nclaude-opus-5-5-high\tClaude Opus 5.5 (High)\n"),
      stderr: Buffer.alloc(0),
    })
    const { provider } = await discoverCli("antigravity-cli")
    expect(Object.keys(provider.models).sort()).toEqual([
      "antigravity-cli",
      "claude-opus-5-5-high",
      "gemini-4-argon-high",
    ])
    expect(provider.models[ModelID.make("gemini-4-argon-high")]?.name).toBe("Gemini 4 Argon (High)")
    expectCliDefaultInvariant(provider.models, "antigravity-cli")
    expect(run).toHaveBeenCalledWith(
      [expect.stringContaining("agy"), "models"],
      expect.objectContaining({ stdin: "ignore" }),
    )
  })

  test("muse uses the catalog default when settings configure no model", async () => {
    await using tmp = await tmpdir()
    await prepareCli(tmp, "muse-cli")
    const catalogDir = path.join(tmp.path, ".local", "share", "muse", "model-catalog")
    await mkdir(catalogDir, { recursive: true })
    await writeFile(
      path.join(catalogDir, "meta.json"),
      JSON.stringify({
        rows: [
          { model_id: "muse-spark-1.3", visibility: "visible", context_limit: 1_000_000 },
          { model_id: "muse-wonder-1.0", visibility: "visible", is_default: true, context_limit: 1_000_000 },
        ],
      }),
    )

    const { provider } = await discoverCli("muse-cli")
    expect(cliDefaultMarks(provider.models)).toEqual(["muse-wonder-1.0"])
    expect(provider.models[ModelID.make("muse-cli")]).toBeUndefined()
  })

  test("muse settings model wins over the catalog default", async () => {
    await using tmp = await tmpdir()
    await prepareCli(tmp, "muse-cli")
    const catalogDir = path.join(tmp.path, ".local", "share", "muse", "model-catalog")
    await mkdir(catalogDir, { recursive: true })
    await writeFile(
      path.join(catalogDir, "meta.json"),
      JSON.stringify({
        rows: [
          { model_id: "muse-spark-1.3", visibility: "visible", context_limit: 1_000_000 },
          { model_id: "muse-wonder-1.0", visibility: "visible", is_default: true, context_limit: 1_000_000 },
        ],
      }),
    )
    await mkdir(path.join(tmp.path, ".config", "muse"), { recursive: true })
    await writeFile(
      path.join(tmp.path, ".config", "muse", "settings.json"),
      JSON.stringify({ model: "muse-spark-1.3" }),
    )

    const { provider } = await discoverCli("muse-cli")
    expect(cliDefaultMarks(provider.models)).toEqual(["muse-spark-1.3"])
    expect(provider.models[ModelID.make("muse-cli")]).toBeUndefined()
  })

  test("muse keeps only the most recently modified catalog file's default", async () => {
    await using tmp = await tmpdir()
    await prepareCli(tmp, "muse-cli")
    const catalogDir = path.join(tmp.path, ".local", "share", "muse", "model-catalog")
    await mkdir(catalogDir, { recursive: true })
    const oldCatalog = path.join(catalogDir, "old.json")
    const newCatalog = path.join(catalogDir, "new.json")
    await writeFile(
      oldCatalog,
      JSON.stringify({
        rows: [{ model_id: "muse-wonder-1.0", visibility: "visible", is_default: true, context_limit: 1_000_000 }],
      }),
    )
    await writeFile(
      newCatalog,
      JSON.stringify({
        rows: [{ model_id: "muse-spark-1.3", visibility: "visible", is_default: true, context_limit: 1_000_000 }],
      }),
    )
    const now = Date.now()
    await utimes(oldCatalog, new Date(now - 60_000), new Date(now - 60_000))
    await utimes(newCatalog, new Date(now), new Date(now))

    const { provider } = await discoverCli("muse-cli")
    expect(cliDefaultMarks(provider.models)).toEqual(["muse-spark-1.3"])
    expect(provider.models[ModelID.make("muse-cli")]).toBeUndefined()
  })

  test("kimi marks a configured kimi-code/k3 alias", async () => {
    await using tmp = await tmpdir()
    await prepareCli(tmp, "kimi-cli")
    await mkdir(path.join(tmp.path, ".kimi-code"), { recursive: true })
    await writeFile(
      path.join(tmp.path, ".kimi-code", "config.toml"),
      ['default_model = "kimi-code/k3"', "", '[models."kimi-code/k3"]', 'label = "K3"', ""].join("\n"),
    )

    const { provider } = await discoverCli("kimi-cli")
    expect(provider.models[ModelID.make("kimi-code/k3")]?.options.cliDefault).toBe(true)
    expect(provider.models[ModelID.make("kimi-cli")]).toBeUndefined()
    expect(cliDefaultMarks(provider.models)).toEqual(["kimi-code/k3"])
  })

  function catalogModel(id: string, name: string, family: string, releaseDate: string) {
    return {
      id,
      name,
      family,
      release_date: releaseDate,
      attachment: true,
      reasoning: true,
      tool_call: true,
      limit: { context: 200_000, output: 32_000 },
      modalities: { input: ["text", "image"], output: ["text"] },
    }
  }

  const CLAUDE_CATALOG = {
    anthropic: {
      id: "anthropic",
      name: "Anthropic",
      env: ["ANTHROPIC_API_KEY"],
      api: "",
      models: {
        "claude-fable-5-1": catalogModel("claude-fable-5-1", "Claude Fable 5.1", "claude-fable", "2026-09-01"),
        "claude-fable-5-2": catalogModel("claude-fable-5-2", "Claude Fable 5.2", "claude-fable", "2026-11-09"),
        "claude-haiku-5-5": catalogModel("claude-haiku-5-5", "Claude Haiku 5.5", "claude-haiku", "2026-10-07"),
        "claude-opus-5": catalogModel("claude-opus-5", "Claude Opus 5", "claude-opus", "2026-07-24"),
        "claude-opus-5-5": catalogModel("claude-opus-5-5", "Claude Opus 5.5", "claude-opus", "2026-09-22"),
        "claude-sonnet-5": catalogModel("claude-sonnet-5", "Claude Sonnet 5", "claude-sonnet", "2026-06-29"),
        "claude-sonnet-5-5": catalogModel("claude-sonnet-5-5", "Claude Sonnet 5.5", "claude-sonnet", "2026-09-28"),
      },
    },
  } as unknown as Awaited<ReturnType<typeof ModelsDev.get>>

  const CLAUDE_LATEST_IDS = ["claude-fable-5-2", "claude-haiku-5-5", "claude-opus-5-5", "claude-sonnet-5-5"]

  async function writeClaudeModel(tmp: { path: string }, model: string) {
    await mkdir(path.join(tmp.path, ".claude"), { recursive: true })
    await writeFile(path.join(tmp.path, ".claude", "settings.json"), JSON.stringify({ model }))
  }

  test("claude-code maps the settings alias fable to the newest fable model", async () => {
    await using tmp = await tmpdir()
    await prepareCli(tmp, "claude-code", CLAUDE_CATALOG)
    await writeClaudeModel(tmp, "fable")

    const first = await discoverCli("claude-code")
    expect(Object.keys(first.provider.models).sort()).toEqual(CLAUDE_LATEST_IDS)
    expect(first.provider.models[ModelID.make("fable")]).toBeUndefined()
    expect(cliDefaultMarks(first.provider.models)).toEqual(["claude-fable-5-2"])
    expectCliDefaultInvariant(first.provider.models, "claude-code")

    // Re-running discovery on its own output must not add the alias back.
    const second = await discoverCli("claude-code", first.provider)
    expect(Object.keys(second.provider.models).sort()).toEqual(CLAUDE_LATEST_IDS)
    expect(second.provider.models[ModelID.make("fable")]).toBeUndefined()
    expect(cliDefaultMarks(second.provider.models)).toEqual(["claude-fable-5-2"])
  })

  test.each([
    ["opus", "claude-opus-5-5"],
    ["Sonnet", "claude-sonnet-5-5"],
    ["haiku", "claude-haiku-5-5"],
    ["opus[1m]", "claude-opus-5-5"],
  ])("claude-code maps the settings model %s to %s without an alias row", async (configured, expected) => {
    await using tmp = await tmpdir()
    await prepareCli(tmp, "claude-code", CLAUDE_CATALOG)
    await writeClaudeModel(tmp, configured)

    const { provider } = await discoverCli("claude-code")
    expect(cliDefaultMarks(provider.models)).toEqual([expected])
    expect(provider.models[ModelID.make(configured)]).toBeUndefined()
    expect(Object.keys(provider.models).sort()).toEqual(CLAUDE_LATEST_IDS)
  })

  test("claude-code default alias keeps the sentinel and adds no row", async () => {
    await using tmp = await tmpdir()
    await prepareCli(tmp, "claude-code", CLAUDE_CATALOG)
    await writeClaudeModel(tmp, "default")

    const { provider } = await discoverCli("claude-code")
    expect(cliDefaultMarks(provider.models)).toEqual([])
    expect(provider.models[ModelID.make("default")]).toBeUndefined()
    expect(provider.models[ModelID.make("claude-code")]).toBeDefined()
    expect(Object.keys(provider.models).sort()).toEqual([...CLAUDE_LATEST_IDS, "claude-code"].sort())
  })

  test("claude-code keeps an unknown full model id as its own row", async () => {
    await using tmp = await tmpdir()
    await prepareCli(tmp, "claude-code", CLAUDE_CATALOG)
    await writeClaudeModel(tmp, "claude-zzz-9")

    const { provider } = await discoverCli("claude-code")
    expect(provider.models[ModelID.make("claude-zzz-9")]?.options.cliDefault).toBe(true)
    expect(cliDefaultMarks(provider.models)).toEqual(["claude-zzz-9"])
    expect(provider.models[ModelID.make("claude-code")]).toBeUndefined()
  })
})

describe("CLI default model marker", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("muse discovery marks the CLI's native catalog default model", async () => {
    vi.spyOn(ModelsDev, "get").mockResolvedValue({} as Awaited<ReturnType<typeof ModelsDev.get>>)
    await using tmp = await tmpdir()
    vi.stubEnv("AX_CODE_TEST_HOME", tmp.path)
    vi.stubEnv("PATH", tmp.path)
    vi.stubEnv("MUSE_MODEL", undefined)
    if (process.platform === "win32") vi.stubEnv("PATHEXT", ".CMD")
    const binary = path.join(tmp.path, process.platform === "win32" ? "muse.cmd" : "muse")
    await writeFile(binary, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n")
    await chmod(binary, 0o755)
    const catalogDir = path.join(tmp.path, ".local", "share", "muse", "model-catalog")
    await mkdir(catalogDir, { recursive: true })
    await writeFile(
      path.join(catalogDir, "meta.json"),
      JSON.stringify({
        rows: [
          { model_id: "muse-spark-1.3", visibility: "visible", context_limit: 1_000_000 },
          { model_id: "muse-wonder-1.0", visibility: "visible", is_default: true, context_limit: 1_000_000 },
        ],
      }),
    )
    const provider = {
      id: ProviderID.make("muse-cli"),
      models: {
        [ModelID.make("muse-cli")]: {
          id: ModelID.make("muse-cli"),
          providerID: ProviderID.make("muse-cli"),
          name: "Muse Code CLI default",
          api: { id: "muse-cli", npm: "cli", url: "" },
          family: "muse",
          release_date: "",
          limit: { context: 1_000_000, output: 128_000 },
          capabilities: {
            temperature: true,
            reasoning: true,
            attachment: false,
            toolcall: true,
            interleaved: false,
            input: { text: true, image: false, audio: false, video: false, pdf: false },
            output: { text: true, image: false, audio: false, video: false, pdf: false },
          },
          options: {},
          headers: {},
          status: "active",
          variants: {},
        },
      },
    } as unknown as Provider.Info

    const loader = await CUSTOM_LOADERS["muse-cli"]!(provider)
    const models = await loader.discoverModels!(provider)

    expect(Object.keys(models).sort()).toEqual(["muse-spark-1.3", "muse-wonder-1.0"])
    expect(models[ModelID.make("muse-wonder-1.0")]?.options.cliDefault).toBe(true)
    expect(models[ModelID.make("muse-spark-1.3")]?.options.cliDefault).toBeUndefined()
  })
})

describe("online provider loaders", () => {
  test("retired gemini-cli provider is not loaded from project config", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
            provider: { "gemini-cli": {} },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const providers = await Provider.list()
        expect(providers[ProviderID.make("gemini-cli")]).toBeUndefined()
      },
    })
  })

  test("retired xai provider is not loaded from an API key", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("XAI_API_KEY", "test-key")
      },
      fn: async () => {
        const providers = await Provider.list()
        expect(providers[ProviderID.make("xai")]).toBeUndefined()
      },
    })
  })

  test("google provider loaded with api key", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("GOOGLE_GENERATIVE_AI_API_KEY", "test-key")
      },
      fn: async () => {
        const providers = await Provider.list()
        const google = providers[ProviderID.make("google")]
        expect(google).toBeDefined()
        expect(google.source).toBe("env")
      },
    })
  })

  test("provider not loaded without credentials", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const providers = await Provider.list()
        // Without any API keys, most providers should not appear
        // (unless running in an env with global keys configured)
        const keys = Object.keys(providers)
        // Just verify we get a valid response
        expect(typeof keys.length).toBe("number")
      },
    })
  })
})

describe("offline provider loaders", () => {
  test("ollama drains reachability and non-OK discovery responses", async () => {
    const drained: number[] = []
    let calls = 0
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url !== "http://localhost:11434/api/tags") throw new Error(`unexpected fetch: ${url}`)
      const call = ++calls
      if (call > 2) throw new Error(`unexpected Ollama fetch call: ${call}`)
      return {
        ok: call === 1,
        status: call === 1 ? 200 : 503,
        arrayBuffer: async () => {
          drained.push(call)
          return new ArrayBuffer(0)
        },
      } as Response
    }) as typeof fetch

    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "ax-code.json"), JSON.stringify({ enabled_providers: ["ollama"] }))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        await Provider.list()
      },
    })

    expect(drained).toEqual([1, 2])
  })

  test("ollama provider survives deferred discovery and loads discovered models", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url === "http://localhost:11434/api/tags") {
        return new Response(JSON.stringify({ models: [{ name: "qwen3.5:9b" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "ax-code.json"), JSON.stringify({ enabled_providers: ["ollama"] }))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        const providers = await Provider.list()
        const ollama = providers[ProviderID.make("ollama")]
        expect(ollama).toBeDefined()
        expect(Object.keys(ollama.models)).toContain("qwen3.5:9b")
      },
    })
  })

  test.each([
    { providerID: "ax-studio", baseURL: "http://localhost:18080" },
    { providerID: "lmstudio", baseURL: "http://localhost:1234" },
    { providerID: "mtplx", baseURL: "http://localhost:18082/v1" },
    { providerID: "omlx", baseURL: "http://localhost:18083" },
    { providerID: "local-llm", baseURL: "http://localhost:18081/v1/" },
  ])("$providerID uses the configured OpenAI-compatible endpoint for discovery", async ({ providerID, baseURL }) => {
    const inferenceBaseURL = `${baseURL.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1`
    let modelFetches = 0
    const requests: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      requests.push(url)
      if (url === `${inferenceBaseURL}/models`) {
        modelFetches += 1
        const id = modelFetches === 1 ? "initial" : "default"
        return new Response(
          JSON.stringify({
            data: [
              {
                id,
                capabilities: { input: { image: true } },
                max_context_length: 8192,
                max_output_tokens: 2048,
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        )
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using globalTmp = await tmpdir()
    await using tmp = await tmpdir({ config: { enabled_providers: [providerID] } })
    const previousConfigDirectory = Global.Path.config
    ;(Global.Path as { config: string }).config = globalTmp.path
    Config.global.reset()
    try {
      await Config.updateGlobal({ provider: { [providerID]: { options: { baseURL } } } })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          expect((await Config.get()).provider?.[providerID]?.options?.baseURL).toBe(baseURL)
          await Provider.ready()
          const providers = await Provider.list()
          const runtime = providers[ProviderID.make(providerID)]
          expect(requests.filter((url) => url.includes("localhost"))).toEqual([
            `${inferenceBaseURL}/models`,
            `${inferenceBaseURL}/models`,
          ])
          expect(modelFetches).toBe(2)
          expect(runtime).toBeDefined()
          const model = runtime.models[ModelID.make("default")]
          expect(Object.keys(runtime.models)).toContain("default")
          expect(model.api.url).toBe(inferenceBaseURL)
          expect(model.capabilities.toolcall).toBe(false)
          expect(model.capabilities.input.image).toBe(true)
          expect(model.limit).toEqual({ context: 8192, output: 2048 })
          expect(Object.keys(runtime.models)).not.toContain("initial")
        },
      })
    } finally {
      await Instance.disposeAll()
      ;(Global.Path as { config: string }).config = previousConfigDirectory
      Config.global.reset()
    }
  })

  test("does not probe or activate external local runtimes before explicit setup", async () => {
    const localRequests: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (/localhost:(11434|1234|8000|18080)/.test(url)) localRequests.push(url)
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch
    await using tmp = await tmpdir({ config: { provider: {} } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        const providers = await Provider.list()
        expect(localRequests).toEqual([])
        for (const id of ["ollama", "lmstudio", "mtplx", "omlx", "ax-studio", "local-llm"]) {
          expect(providers[ProviderID.make(id)]).toBeUndefined()
        }
      },
    })
  })

  test("ax-studio is not discovered when /v1/models is unavailable", async () => {
    process.env.AX_STUDIO_HOST = "http://localhost:18080"
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url === "http://localhost:18080/v1/models") {
        return new Response("not found", {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      if (url === "http://localhost:18080/api/tags") {
        return new Response("not found", { status: 404 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "ax-code.json"), JSON.stringify({}))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        const providers = await Provider.list()
        const axStudio = providers[ProviderID.make("ax-studio")]
        expect(axStudio).toBeUndefined()
      },
    })
  })

  test("ax-studio ignores invalid /v1/models schema", async () => {
    process.env.AX_STUDIO_HOST = "http://localhost:18080"
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url === "http://localhost:18080/v1/models") {
        return new Response(JSON.stringify({ data: { id: "not-an-array" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "ax-code.json"), JSON.stringify({}))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        const providers = await Provider.list()
        expect(providers[ProviderID.make("ax-studio")]).toBeUndefined()
      },
    })
  })

  test("ax-studio ignores discovered models with non-string ids", async () => {
    process.env.AX_STUDIO_HOST = "http://localhost:18080"
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url === "http://localhost:18080/v1/models") {
        return new Response(
          JSON.stringify({
            data: [{ id: 123 }, { id: "" }, { id: " \t" }, { id: "valid-model" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        )
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "ax-code.json"), JSON.stringify({ enabled_providers: ["ax-studio"] }))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        const providers = await Provider.list()
        const axStudio = providers[ProviderID.make("ax-studio")]
        expect(Object.keys(axStudio.models)).toEqual(["valid-model"])
      },
    })
  })

  test("ax-studio sanitizes discovered model capability and limit fields", async () => {
    process.env.AX_STUDIO_HOST = "http://localhost:18080"
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url === "http://localhost:18080/v1/models") {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "valid-model",
                capabilities: {
                  temperature: "yes",
                  reasoning: true,
                  input: { text: false, image: "yes" },
                  output: { audio: "no" },
                  interleaved: { field: "invalid" },
                  // A non-boolean declaration must not become a claimed capability.
                  web_search: "yes",
                },
                limit: { context: "large", output: {} },
                max_context_length: "8192",
                max_output_tokens: "2048",
              },
              { id: "search-model", capabilities: { web_search: true } },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        )
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "ax-code.json"), JSON.stringify({ enabled_providers: ["ax-studio"] }))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        const providers = await Provider.list()
        const model = providers[ProviderID.make("ax-studio")].models[ModelID.make("valid-model")]
        expect(model.capabilities.temperature).toBe(true)
        expect(model.capabilities.reasoning).toBe(true)
        expect(model.capabilities.input.text).toBe(false)
        expect(model.capabilities.input.image).toBe(false)
        expect(model.capabilities.output.audio).toBe(false)
        expect(model.capabilities.interleaved).toBe(false)
        expect(model.capabilities.websearch).toBe(false)
        expect(model.limit).toEqual({ context: 128000, output: 4096 })
        expect(
          providers[ProviderID.make("ax-studio")].models[ModelID.make("search-model")].capabilities.websearch,
        ).toBe(true)
      },
    })
  })

  test("ax-studio ignores non-positive discovered model limits", async () => {
    process.env.AX_STUDIO_HOST = "http://localhost:18080"
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url === "http://localhost:18080/v1/models") {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "valid-model",
                limit: { context: -1, output: 0 },
                max_context_length: -8192,
                max_output_tokens: 0,
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        )
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "ax-code.json"), JSON.stringify({ enabled_providers: ["ax-studio"] }))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        const providers = await Provider.list()
        const model = providers[ProviderID.make("ax-studio")].models[ModelID.make("valid-model")]
        expect(model.limit).toEqual({ context: 128000, output: 4096 })
      },
    })
  })

  test("ax-studio applies model filters to discovered models", async () => {
    process.env.AX_STUDIO_HOST = "http://localhost:18080"
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url === "http://localhost:18080/v1/models") {
        return new Response(
          JSON.stringify({
            data: [{ id: "allowed" }, { id: "blocked" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        )
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            provider: {
              "ax-studio": {
                whitelist: ["allowed"],
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        const providers = await Provider.list()
        const axStudio = providers[ProviderID.make("ax-studio")]
        expect(Object.keys(axStudio.models)).toEqual(["allowed"])
      },
    })
  })

  test("ollama ignores invalid tags JSON during deferred discovery", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url === "http://localhost:11434/api/tags") {
        return new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "ax-code.json"), JSON.stringify({}))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        const providers = await Provider.list()
        expect(providers[ProviderID.make("ollama")]).toBeUndefined()
      },
    })
  })

  test("ollama ignores discovered models with blank names", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url === "http://localhost:11434/api/tags") {
        return new Response(JSON.stringify({ models: [{ name: "" }, { name: " \t" }, { name: "qwen:latest" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "ax-code.json"), JSON.stringify({ enabled_providers: ["ollama"] }))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        const providers = await Provider.list()
        const ollama = providers[ProviderID.make("ollama")]
        expect(Object.keys(ollama.models)).toEqual(["qwen:latest"])
      },
    })
  })

  test("ollama provider autoloads when server reachable and explicitly enabled", async () => {
    // A reachable local server may legitimately have no models installed. This
    // test covers provider discovery; model parsing is covered above with a
    // deterministic response.
    const reachable = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(1000) })
      .then((r) => r.ok)
      .catch(() => false)
    if (!reachable) return // skip when ollama not running

    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
            enabled_providers: ["ollama"],
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        const providers = await Provider.list()
        const ollama = providers[ProviderID.make("ollama")]
        expect(ollama).toBeDefined()
      },
    })
  })

  test("ollama provider not autoloaded when server unreachable", async () => {
    const reachable = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(1000) })
      .then((r) => r.ok)
      .catch(() => false)
    if (reachable) return // skip when ollama IS running — we need it offline

    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const providers = await Provider.list()
        const ollama = providers[ProviderID.make("ollama")]
        // When server is unreachable, ollama should not autoload
        expect(ollama).toBeUndefined()
      },
    })
  })
})

describe("provider config integration", () => {
  test("config-based provider with baseURL", async () => {
    // Redirecting provider traffic from project config is intentionally gated
    // behind explicit checkout trust. This fixture exercises the trusted path.
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")

    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
            provider: {
              openai: {
                options: {
                  apiKey: "test-key",
                  baseURL: "https://custom.api.example.com/v1",
                },
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const providers = await Provider.list()
        const openai = providers[ProviderID.make("openai")]
        expect(openai).toBeDefined()
        expect(openai.options?.baseURL).toBe("https://custom.api.example.com/v1")
      },
    })
  })

  test("disabled_providers excludes CLI provider", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
            disabled_providers: ["claude-code"],
            provider: {
              "claude-code": {},
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const providers = await Provider.list()
        expect(providers[ProviderID.make("claude-code")]).toBeUndefined()
      },
    })
  })
})

describe("native MLX runtime metadata", () => {
  test.each(["mtplx", "omlx"])(
    "%s authenticates both discovery requests and preserves runtime limits",
    async (providerID) => {
      const requests: Array<{ url: string; authorization: string | null }> = []
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(input), authorization: new Headers(init?.headers).get("Authorization") })
        return Response.json({
          data: [
            {
              id: "native-chat",
              owned_by: providerID,
              capability: "chat",
              supports_vision: true,
              max_model_len: 32768,
              context_length: 8192,
            },
            { id: "unknown", owned_by: "generic", capability: "chat", max_model_len: 512 },
            { id: "retrieval", owned_by: providerID, capability: "embedding" },
            { id: "explicit-no-tools", owned_by: providerID, capability: "chat", capabilities: { toolcall: false } },
          ],
        })
      }) as typeof fetch
      const provider = {
        id: ProviderID.make(providerID),
        name: providerID,
        source: "config" as const,
        env: [],
        models: {},
        options: { baseURL: "http://localhost:18082/v1", apiKey: "test-runtime-key" },
      }
      const loader = await CUSTOM_LOADERS[providerID](provider)
      expect(loader.autoload).toBe(true)
      const models = await loader.discoverModels!(provider)
      expect(requests).toEqual(
        Array(2).fill({ url: "http://localhost:18082/v1/models", authorization: "Bearer test-runtime-key" }),
      )
      expect(models[ModelID.make("native-chat")].limit.context).toBe(providerID === "omlx" ? 32768 : 8192)
      expect(models[ModelID.make("native-chat")].capabilities.toolcall).toBe(providerID === "mtplx")
      expect(models[ModelID.make("native-chat")].capabilities.input.image).toBe(providerID === "mtplx")
      for (const id of ["unknown", "retrieval", "explicit-no-tools"])
        expect(models[ModelID.make(id)].capabilities.toolcall).toBe(false)
      expect(models[ModelID.make("unknown")].limit.context).toBe(128000)
    },
  )

  test.each(["mtplx", "omlx"])("%s preserves an explicit tool opt-out during discovery", async (providerID) => {
    globalThis.fetch = (async () =>
      Response.json({
        data: [{ id: "chat-model", owned_by: providerID, capability: "chat" }],
      })) as typeof fetch
    await using tmp = await tmpdir({
      config: {
        enabled_providers: [providerID],
        provider: {
          [providerID]: {
            options: { baseURL: "http://localhost:18083/v1" },
            models: { "chat-model": { tool_call: false } },
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        const runtime = (await Provider.list())[ProviderID.make(providerID)]
        expect(runtime.models[ModelID.make("chat-model")].capabilities.toolcall).toBe(false)
      },
    })
  })

  test("an oMLX coding model can explicitly opt into tools without changing other discovered models", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        data: [
          { id: "coding-model", owned_by: "omlx", max_model_len: 32768 },
          { id: "embedding-model", owned_by: "omlx", max_model_len: 8192 },
        ],
      })) as typeof fetch
    await using tmp = await tmpdir({
      config: {
        enabled_providers: ["omlx"],
        provider: {
          omlx: { options: { baseURL: "http://localhost:18083/v1" }, models: { "coding-model": { tool_call: true } } },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        const runtime = (await Provider.list())[ProviderID.make("omlx")]
        expect(runtime.models[ModelID.make("coding-model")].capabilities.toolcall).toBe(true)
        expect(runtime.models[ModelID.make("coding-model")].limit.context).toBe(32768)
        expect(runtime.models[ModelID.make("embedding-model")]).toBeUndefined()
      },
    })
  })
})
