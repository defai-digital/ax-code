import { createServer } from "node:http"
import { describe, expect, test, vi } from "vitest"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { MCP } from "../../src/mcp"
import { tmpdir } from "../fixture/fixture"
import { TEMPLATES, byCategory, find, names, toConfig } from "../../src/mcp/templates"

describe("mcp templates", () => {
  test("every template has a unique name", () => {
    const seen = new Set<string>()
    for (const template of TEMPLATES) {
      expect(seen.has(template.name), `duplicate template name: ${template.name}`).toBe(false)
      seen.add(template.name)
    }
  })

  test("helpers resolve templates", () => {
    expect(names()).toContain("github")
    expect(find("github")?.type).toBe("local")
    expect(find("does-not-exist")).toBeUndefined()
    expect(Object.keys(byCategory()).length).toBeGreaterThan(0)
  })

  test("cloud provider templates are registered", () => {
    for (const name of ["aws", "gcp", "cloudflare", "digitalocean"]) {
      expect(names(), `missing template: ${name}`).toContain(name)
    }
    expect(find("aws")?.type).toBe("local")
    expect(find("digitalocean")?.envRequired).toContain("DIGITALOCEAN_ACCESS_TOKEN")
  })

  test("AX BI connection is disabled, loopback-scoped and contains only a key reference", () => {
    const config = toConfig(find("ax-bi")!, { AXBI_MCP_API_KEY: "test-never-persist-me" })
    expect(config).toEqual({
      type: "remote",
      url: "http://127.0.0.1:31421/mcp",
      enabled: false,
      allowLoopback: true,
      oauth: false,
      headers: { Authorization: "Bearer {env:AXBI_MCP_API_KEY}" },
    })
    expect(JSON.stringify(config)).not.toContain("test-never-persist-me")
    expect(Config.McpRemote.safeParse(config).success).toBe(true)
  })

  test("an unconfigured AX BI template sends no request during normal MCP startup", async () => {
    let requests = 0
    const server = createServer((_request, response) => {
      requests++
      response.end()
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing fixture address")
    vi.stubEnv("AXBI_MCP_API_KEY", undefined)
    try {
      const config = Config.McpRemote.parse(toConfig(find("ax-bi")!))
      await using fixture = await tmpdir({
        git: true,
        config: {
          mcp: {
            "ax-bi": { ...config, url: `http://127.0.0.1:${address.port}/mcp` },
          },
        },
      })
      await Instance.provide({
        directory: fixture.path,
        fn: async () => {
          expect((await MCP.status())["ax-bi"].status).toBe("disabled")
          expect((await MCP.clients())["ax-bi"]).toBeUndefined()
        },
      })
      expect(requests).toBe(0)
    } finally {
      await Instance.disposeAll()
      vi.unstubAllEnvs()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  describe("toConfig", () => {
    test("local template merges collected environment into config", () => {
      const github = find("github")!
      const config = toConfig(github, { GITHUB_TOKEN: "ghp_test" })
      expect(config).toEqual({
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-github"],
        environment: { GITHUB_TOKEN: "ghp_test" },
      })
      // Validates against the real McpLocal schema (.strict()).
      expect(() => Config.McpLocal.parse(config)).not.toThrow()
    })

    test("local template without environment omits the field", () => {
      const filesystem = find("filesystem")!
      const config = toConfig(filesystem)
      expect(config).toEqual({
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."],
      })
      expect(config.environment).toBeUndefined()
      expect(() => Config.McpLocal.parse(config)).not.toThrow()
    })

    test("local template without environment and without command is still well-formed", () => {
      const config = toConfig({ ...find("filesystem")!, command: undefined, args: undefined })
      expect(config).toEqual({ type: "local" })
    })

    test("local schema rejects blank command executables", () => {
      expect(Config.McpLocal.safeParse({ type: "local", command: [] }).success).toBe(false)
      expect(Config.McpLocal.safeParse({ type: "local", command: ["   "] }).success).toBe(false)
      expect(Config.McpLocal.safeParse({ type: "local", command: ["node", "server.js"] }).success).toBe(true)
    })

    test("empty environment map does not add the field", () => {
      const github = find("github")!
      const config = toConfig(github, {})
      expect(config.environment).toBeUndefined()
    })

    test("remote template ignores environment (McpRemote has no environment field)", () => {
      const exa = find("exa")!
      const config = toConfig(exa, { EXA_API_KEY: "exa-test" })
      expect(config).toEqual({ type: "remote", url: "https://mcp.exa.ai/mcp" })
      // Validates against the real McpRemote schema (.strict()).
      // A stray `environment` key would be rejected here.
      expect(() => Config.McpRemote.parse(config)).not.toThrow()
    })

    test("remote schema rejects invalid and non-HTTP URLs", () => {
      expect(Config.McpRemote.safeParse({ type: "remote", url: "https://mcp.example.com/mcp" }).success).toBe(true)
      expect(Config.McpRemote.safeParse({ type: "remote", url: "not a url" }).success).toBe(false)
      expect(Config.McpRemote.safeParse({ type: "remote", url: "file:///tmp/mcp.sock" }).success).toBe(false)
    })

    test("every local template config validates against the McpLocal schema", () => {
      for (const template of TEMPLATES.filter((t) => t.type === "local")) {
        // Simulate collected env for declared required vars.
        const env: Record<string, string> = {}
        for (const v of template.envRequired ?? []) env[v] = "test-value"
        const config = toConfig(template, env)
        expect(() => Config.McpLocal.parse(config), `invalid local config: ${template.name}`).not.toThrow()
      }
    })

    test("every remote template config validates against the McpRemote schema", () => {
      for (const template of TEMPLATES.filter((t) => t.type === "remote")) {
        const config = toConfig(template)
        expect(() => Config.McpRemote.parse(config), `invalid remote config: ${template.name}`).not.toThrow()
      }
    })
  })
})
