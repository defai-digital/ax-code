import { afterEach, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import path from "path"
import { CompatibilityImport } from "../src/import/compatibility"
import { Global } from "../src/global"
import { tmpdir } from "./fixture/fixture"

describe("CompatibilityImport", () => {
  test("keeps dotted agent subdirectories when planning imports", async () => {
    await using tmp = await tmpdir()
    const agentDir = path.join(tmp.path, ".opencode", "agents", "..legacy")
    await fs.mkdir(agentDir, { recursive: true })
    await fs.writeFile(path.join(agentDir, "triage.md"), "# Triage\n", "utf-8")

    const report = await CompatibilityImport.plan({ source: "opencode", directory: tmp.path })
    expect(report.candidates).toContainEqual(
      expect.objectContaining({
        kind: "agent",
        sourcePath: path.join(agentDir, "triage.md"),
        targetPath: path.join(tmp.path, ".ax-code", "agent", "..legacy", "triage.md"),
      }),
    )
  })

  test("imports commands from the singular command directory", async () => {
    await using tmp = await tmpdir()
    const commandDir = path.join(tmp.path, ".opencode", "command")
    await fs.mkdir(commandDir, { recursive: true })
    await fs.writeFile(path.join(commandDir, "deploy.md"), "---\ndescription: deploy\n---\nRun it.\n", "utf-8")

    const report = await CompatibilityImport.plan({ source: "opencode", directory: tmp.path })
    expect(report.candidates).toContainEqual(
      expect.objectContaining({
        kind: "command",
        sourcePath: path.join(commandDir, "deploy.md"),
        targetPath: path.join(tmp.path, ".ax-code", "commands", "deploy.md"),
      }),
    )
  })

  test("imports skills from the singular skill directory", async () => {
    await using tmp = await tmpdir()
    const skillDir = path.join(tmp.path, ".opencode", "skill", "release")
    await fs.mkdir(skillDir, { recursive: true })
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "# Release\n", "utf-8")

    const report = await CompatibilityImport.plan({ source: "opencode", directory: tmp.path })
    expect(report.candidates).toContainEqual(
      expect.objectContaining({
        kind: "skill",
        sourcePath: path.join(skillDir, "SKILL.md"),
        targetPath: path.join(tmp.path, ".ax-code", "skill", "release", "SKILL.md"),
      }),
    )
  })
})

describe("CompatibilityImport MCP servers (ADR-220)", () => {
  const MCP_JSON = {
    mcpServers: {
      github: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: {
          GITHUB_TOKEN: "${GITHUB_TOKEN}",
          LITERAL_SECRET: "super-secret-value",
        },
      },
      docs: {
        type: "http",
        url: "https://mcp.example.com/docs",
        headers: { Authorization: "${DOCS_TOKEN}", X_Static: "header-literal-value" },
      },
      broken: { unexpected: true },
    },
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("dry-run maps servers, omits literal env/header values, never prints them", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(path.join(dir, ".mcp.json"), JSON.stringify(MCP_JSON), "utf-8")
      },
    })

    const report = await CompatibilityImport.plan({ source: "claude", directory: tmp.path })
    const mcp = report.candidates.filter((item) => item.kind === "mcp")
    expect(mcp.length).toBe(3)

    const github = mcp.find((item) => item.targetPath.endsWith("#mcp/github"))
    expect(github?.action).toBe("copy")
    expect(github?.warnings).toContain("env_value_omitted:LITERAL_SECRET")

    const docs = mcp.find((item) => item.targetPath.endsWith("#mcp/docs"))
    expect(docs?.action).toBe("copy")
    expect(docs?.warnings).toContain("header_value_omitted:X_Static")

    const broken = mcp.find((item) => item.targetPath.endsWith("#mcp/broken"))
    expect(broken?.action).toBe("skip")
    expect(broken?.reason).toBe("unsupported_mcp_shape")

    // Secret non-disclosure: variable names only, never values.
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain("super-secret-value")
    expect(serialized).not.toContain("header-literal-value")
    expect(serialized).toContain("LITERAL_SECRET")
  })

  test("write merges disabled servers into the project config without overwriting", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(path.join(dir, ".mcp.json"), JSON.stringify(MCP_JSON), "utf-8")
        // An existing github entry must never be overwritten.
        await fs.writeFile(
          path.join(dir, "ax-code.json"),
          JSON.stringify({ mcp: { github: { type: "local", command: ["keep-me"] } } }),
          "utf-8",
        )
      },
    })

    const report = await CompatibilityImport.run({ source: "claude", directory: tmp.path, write: true })
    const github = report.candidates.find((item) => item.targetPath.endsWith("#mcp/github"))
    expect(github?.action).toBe("skip")
    expect(github?.reason).toBe("target_exists")

    const config = JSON.parse(await fs.readFile(path.join(tmp.path, "ax-code.json"), "utf-8"))
    expect(config.mcp.github).toEqual({ type: "local", command: ["keep-me"] })
    expect(config.mcp.docs).toEqual({
      type: "remote",
      url: "https://mcp.example.com/docs",
      enabled: false,
      headers: { Authorization: "{env:DOCS_TOKEN}" },
    })
    expect(config.mcp.broken).toBeUndefined()
    // Only reference-style env values are carried; literals are omitted.
    expect(JSON.stringify(config)).not.toContain("super-secret-value")
    expect(JSON.stringify(config)).not.toContain("LITERAL_SECRET")
  })

  test("writes local servers as disabled with {env:VAR} references", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(path.join(dir, ".mcp.json"), JSON.stringify(MCP_JSON), "utf-8")
      },
    })

    await CompatibilityImport.run({ source: "claude", directory: tmp.path, write: true })
    const config = JSON.parse(await fs.readFile(path.join(tmp.path, "ax-code.json"), "utf-8"))
    expect(config.mcp.github).toEqual({
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-github"],
      enabled: false,
      environment: { GITHUB_TOKEN: "{env:GITHUB_TOKEN}" },
    })
  })

  test("reads user-level ~/.claude.json only with the explicit user flag", async () => {
    await using home = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(
          path.join(dir, ".claude.json"),
          JSON.stringify({ mcpServers: { personal: { command: "uvx", args: ["personal-mcp"] } } }),
          "utf-8",
        )
      },
    })
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(
          path.join(dir, ".claude.json"),
          JSON.stringify({
            projects: { [path.resolve(dir)]: { mcpServers: { scoped: { command: "npx", args: ["scoped-mcp"] } } } },
          }),
          "utf-8",
        )
      },
    })

    const homeSpy = vi.spyOn(Global.Path, "home", "get").mockReturnValue(home.path)
    try {
      const withoutUser = await CompatibilityImport.plan({ source: "claude", directory: tmp.path })
      expect(
        withoutUser.candidates
          .filter((item) => item.kind === "mcp")
          .map((item) => item.targetPath)
          .join("\n"),
      ).not.toContain("personal")

      const withUser = await CompatibilityImport.plan({ source: "claude", directory: tmp.path, user: true })
      const names = withUser.candidates.filter((item) => item.kind === "mcp").map((item) => item.targetPath)
      expect(names.join("\n")).toContain("#mcp/personal")
      expect(names.join("\n")).toContain("#mcp/scoped")
    } finally {
      homeSpy.mockRestore()
    }
  })

  test("a project MCP entry wins over a same-named user-level entry", async () => {
    await using home = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(
          path.join(dir, ".claude.json"),
          JSON.stringify({ mcpServers: { shared: { command: "user-cmd" } } }),
          "utf-8",
        )
      },
    })
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(
          path.join(dir, ".mcp.json"),
          JSON.stringify({ mcpServers: { shared: { command: "project-cmd" } } }),
          "utf-8",
        )
      },
    })

    const homeSpy = vi.spyOn(Global.Path, "home", "get").mockReturnValue(home.path)
    try {
      const report = await CompatibilityImport.run({ source: "claude", directory: tmp.path, user: true, write: true })
      const shared = report.candidates.filter((item) => item.targetPath.endsWith("#mcp/shared"))
      expect(shared).toHaveLength(2)
      expect(shared[0]).toEqual(
        expect.objectContaining({ action: "copy", sourcePath: path.join(tmp.path, ".mcp.json") }),
      )
      expect(shared[1]).toEqual(
        expect.objectContaining({
          action: "skip",
          reason: "target_exists",
          sourcePath: path.join(home.path, ".claude.json"),
        }),
      )

      const config = JSON.parse(await fs.readFile(path.join(tmp.path, "ax-code.json"), "utf-8"))
      expect(config.mcp.shared).toEqual({ type: "local", command: ["project-cmd"], enabled: false })
    } finally {
      homeSpy.mockRestore()
    }
  })

  test("codex user config.toml is reported as skipped, not silently ignored", async () => {
    await using home = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".codex"), { recursive: true })
        await fs.writeFile(path.join(dir, ".codex", "config.toml"), '[mcp_servers.docs]\ncommand = "npx"\n', "utf-8")
      },
    })
    await using tmp = await tmpdir()

    const homeSpy = vi.spyOn(Global.Path, "home", "get").mockReturnValue(home.path)
    try {
      // ADR-227: smol-toml 1.9.0 is now in the catalog, so the user-level
      // config.toml is parsed — the docs server becomes a copy candidate
      // (disabled) rather than a skip with the toml_parser_unavailable
      // reason the pre-ADR-227 placeholder emitted.
      const report = await CompatibilityImport.plan({ source: "codex", directory: tmp.path, user: true })
      const docs = report.candidates.find((item) => item.targetPath.endsWith("#mcp/docs"))
      expect(docs?.action).toBe("copy")
      expect(docs?.sourcePath).toBe(path.join(home.path, ".codex", "config.toml"))
    } finally {
      homeSpy.mockRestore()
    }
  })

  test("mcp targetPath names the project ax-code.json file, not a pending promise", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(path.join(dir, ".mcp.json"), JSON.stringify(MCP_JSON), "utf-8")
      },
    })

    const report = await CompatibilityImport.plan({ source: "claude", directory: tmp.path })
    const github = report.candidates.find((item) => item.targetPath.endsWith("#mcp/github"))
    expect(github?.targetPath).toBe(`${path.join(tmp.path, "ax-code.json")}#mcp/github`)
  })
})

describe("CompatibilityImport Codex MCP servers (ADR-227)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("parses project .codex/config.toml mcp_servers.* into copy candidates (disabled)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".codex"), { recursive: true })
        await fs.writeFile(
          path.join(dir, ".codex", "config.toml"),
          [
            "[mcp_servers.docs]",
            'command = "npx"',
            'args = ["-y", "@modelcontextprotocol/server-docs"]',
            'env = { TOKEN = "${DOCS_TOKEN}", LITERAL = "literal-leak" }',
            "startup_timeout = 1500",
            "",
            "[mcp_servers.disabled_server]",
            'command = "noop"',
            "disabled = true",
            "",
          ].join("\n"),
          "utf-8",
        )
      },
    })
    const report = await CompatibilityImport.plan({ source: "codex", directory: tmp.path })
    const mcp = report.candidates.filter((item) => item.kind === "mcp")
    expect(mcp.length).toBe(2)

    const docs = mcp.find((item) => item.targetPath.endsWith("#mcp/docs"))
    expect(docs?.action).toBe("copy")
    expect(docs?.sourcePath).toBe(path.join(tmp.path, ".codex", "config.toml"))
    // Literal env values are never printed (name-only warning).
    expect(JSON.stringify(report)).not.toContain("literal-leak")
    expect(docs?.warnings).toContain("env_value_omitted:LITERAL")

    const disabled = mcp.find((item) => item.targetPath.endsWith("#mcp/disabled_server"))
    expect(disabled?.action).toBe("copy")
  })

  test("maps Codex URL servers with bearer_token_env_var to a {env:VAR} Authorization header", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".codex"), { recursive: true })
        await fs.writeFile(
          path.join(dir, ".codex", "config.toml"),
          [
            "[mcp_servers.remote]",
            'url = "https://mcp.example.com/remote"',
            'bearer_token_env_var = "REMOTE_TOKEN"',
            "",
          ].join("\n"),
          "utf-8",
        )
      },
    })

    await CompatibilityImport.run({ source: "codex", directory: tmp.path, write: true })
    const config = JSON.parse(await fs.readFile(path.join(tmp.path, "ax-code.json"), "utf-8"))
    expect(config.mcp.remote).toEqual({
      type: "remote",
      url: "https://mcp.example.com/remote",
      enabled: false,
      headers: { Authorization: "{env:REMOTE_TOKEN}" },
    })
  })

  test("does NOT overwrite an existing entry in the project config", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".codex"), { recursive: true })
        await fs.writeFile(path.join(dir, ".codex", "config.toml"), '[mcp_servers.docs]\ncommand = "npx"\n', "utf-8")
        await fs.writeFile(
          path.join(dir, "ax-code.json"),
          JSON.stringify({ mcp: { docs: { type: "local", command: ["keep-me"] } } }),
          "utf-8",
        )
      },
    })
    const report = await CompatibilityImport.run({ source: "codex", directory: tmp.path, write: true })
    const docs = report.candidates.find((item) => item.targetPath.endsWith("#mcp/docs"))
    expect(docs?.action).toBe("skip")
    expect(docs?.reason).toBe("target_exists")
    const config = JSON.parse(await fs.readFile(path.join(tmp.path, "ax-code.json"), "utf-8"))
    expect(config.mcp.docs).toEqual({ type: "local", command: ["keep-me"] })
  })

  test("reads home ~/.codex/config.toml only with --user", async () => {
    await using home = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".codex"), { recursive: true })
        await fs.writeFile(
          path.join(dir, ".codex", "config.toml"),
          '[mcp_servers.personal]\ncommand = "uvx"\nargs = ["personal-mcp"]\n',
          "utf-8",
        )
      },
    })
    await using tmp = await tmpdir()
    const homeSpy = vi.spyOn(Global.Path, "home", "get").mockReturnValue(home.path)
    try {
      const withoutUser = await CompatibilityImport.plan({ source: "codex", directory: tmp.path })
      expect(
        withoutUser.candidates
          .filter((item) => item.kind === "mcp")
          .map((item) => item.targetPath)
          .join("\n"),
      ).not.toContain("#mcp/personal")

      const withUser = await CompatibilityImport.plan({ source: "codex", directory: tmp.path, user: true })
      const names = withUser.candidates.filter((item) => item.kind === "mcp").map((item) => item.targetPath)
      expect(names.join("\n")).toContain("#mcp/personal")
    } finally {
      homeSpy.mockRestore()
    }
  })

  test("a project mcp_servers entry wins over a same-named user-level entry", async () => {
    await using home = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".codex"), { recursive: true })
        await fs.writeFile(
          path.join(dir, ".codex", "config.toml"),
          '[mcp_servers.shared]\ncommand = "user-cmd"\n',
          "utf-8",
        )
      },
    })
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".codex"), { recursive: true })
        await fs.writeFile(
          path.join(dir, ".codex", "config.toml"),
          '[mcp_servers.shared]\ncommand = "project-cmd"\n',
          "utf-8",
        )
      },
    })

    const homeSpy = vi.spyOn(Global.Path, "home", "get").mockReturnValue(home.path)
    try {
      const report = await CompatibilityImport.run({ source: "codex", directory: tmp.path, user: true, write: true })
      const shared = report.candidates.filter((item) => item.targetPath.endsWith("#mcp/shared"))
      expect(shared).toHaveLength(2)
      expect(shared[0]).toEqual(
        expect.objectContaining({
          action: "copy",
          sourcePath: path.join(tmp.path, ".codex", "config.toml"),
        }),
      )
      expect(shared[1]).toEqual(
        expect.objectContaining({
          action: "skip",
          reason: "target_exists",
          sourcePath: path.join(home.path, ".codex", "config.toml"),
        }),
      )

      const config = JSON.parse(await fs.readFile(path.join(tmp.path, "ax-code.json"), "utf-8"))
      expect(config.mcp.shared).toEqual({ type: "local", command: ["project-cmd"], enabled: false })
    } finally {
      homeSpy.mockRestore()
    }
  })

  test("malformed line becomes a skipped source with the line number, not a crash", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".codex"), { recursive: true })
        // 4 lines: a valid table header on line 1, an unterminated string
        // on line 2, a closing bracket on line 3, an unquoted key on
        // line 4. smol-toml surfaces the first failure (line 2).
        await fs.writeFile(
          path.join(dir, ".codex", "config.toml"),
          ["[mcp_servers.docs]", 'command = "unterminated', "]", "key =", ""].join("\n"),
          "utf-8",
        )
      },
    })
    const report = await CompatibilityImport.plan({ source: "codex", directory: tmp.path })
    const mcp = report.candidates.filter((item) => item.kind === "mcp")
    expect(mcp.length).toBe(1)
    const skip = mcp[0]
    expect(skip?.action).toBe("skip")
    expect(skip?.reason).toMatch(/^invalid_source_toml(:\d+)?$/)
  })

  test("unsupported mcp shape (no command, no url) is reported as skip with reason", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".codex"), { recursive: true })
        await fs.writeFile(
          path.join(dir, ".codex", "config.toml"),
          "[mcp_servers.broken]\nunexpected = true\n",
          "utf-8",
        )
      },
    })
    const report = await CompatibilityImport.plan({ source: "codex", directory: tmp.path })
    const broken = report.candidates.find((item) => item.targetPath.endsWith("#mcp/broken"))
    expect(broken?.action).toBe("skip")
    expect(broken?.reason).toBe("unsupported_mcp_shape")
  })

  test("mcp targetPath selects an existing ax-code.jsonc over ax-code.json", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "ax-code.json"), "{}\n", "utf-8")
        await fs.writeFile(path.join(dir, "ax-code.jsonc"), "{}\n", "utf-8")
        await fs.mkdir(path.join(dir, ".codex"), { recursive: true })
        await fs.writeFile(path.join(dir, ".codex", "config.toml"), '[mcp_servers.docs]\ncommand = "npx"\n', "utf-8")
      },
    })

    const report = await CompatibilityImport.plan({ source: "codex", directory: tmp.path })
    const docs = report.candidates.find((item) => item.targetPath.endsWith("#mcp/docs"))
    expect(docs?.targetPath).toBe(`${path.join(tmp.path, "ax-code.jsonc")}#mcp/docs`)
  })
})

describe("CompatibilityImport cursor and windsurf instructions (ADR-220)", () => {
  test("cursor rules and legacy .cursorrules become instruction candidates and are copied", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".cursor", "rules"), { recursive: true })
        await fs.writeFile(
          path.join(dir, ".cursor", "rules", "style.mdc"),
          "---\ndescription: style\n---\nStyle rule.",
          "utf-8",
        )
        await fs.writeFile(path.join(dir, ".cursorrules"), "Legacy cursor rules.", "utf-8")
      },
    })

    const planned = await CompatibilityImport.plan({ source: "cursor", directory: tmp.path })
    expect(planned.candidates.map((item) => item.kind)).toEqual(["instruction", "instruction"])

    const report = await CompatibilityImport.run({ source: "cursor", directory: tmp.path, write: true })
    expect(report.copy).toBe(2)
    expect(
      await fs.readFile(path.join(tmp.path, ".ax-code", "instructions", "cursor", "style.mdc"), "utf-8"),
    ).toContain("Style rule.")
    expect(
      await fs.readFile(path.join(tmp.path, ".ax-code", "instructions", "cursor", "cursorrules.md"), "utf-8"),
    ).toContain("Legacy cursor rules.")
  })

  test("windsurf rules keep their relative layout", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".windsurf", "rules", "frontend"), { recursive: true })
        await fs.writeFile(path.join(dir, ".windsurf", "rules", "frontend", "react.md"), "React rule.", "utf-8")
      },
    })

    const report = await CompatibilityImport.run({ source: "windsurf", directory: tmp.path, write: true })
    expect(report.copy).toBe(1)
    expect(
      await fs.readFile(path.join(tmp.path, ".ax-code", "instructions", "windsurf", "frontend", "react.md"), "utf-8"),
    ).toContain("React rule.")
  })
})
