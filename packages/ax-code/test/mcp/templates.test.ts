import { describe, expect, test } from "bun:test"
import { Config } from "../../src/config/config"
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
