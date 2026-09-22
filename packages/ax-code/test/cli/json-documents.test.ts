import { describe, expect, test } from "vitest"
import yargs from "yargs"
import type { Argv } from "yargs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { buildProvidersDocument, ProvidersListCommand } from "../../src/cli/cmd/providers-impl"
import { buildAgentsDocument, AgentListCommand } from "../../src/cli/cmd/agent"
import {
  buildMcpDocument,
  buildMcpAuthDocument,
  redactUrlCredentials,
  resolveMcpStatus,
  McpListCommand,
  McpAuthListCommand,
} from "../../src/cli/cmd/mcp-impl"
import { buildStatsDocument, statsLargeDatasetNotice, StatsCommand } from "../../src/cli/cmd/stats"
import { buildContextDocument, ContextCommand } from "../../src/cli/cmd/context"
import { MemoryStatusCommand, MemoryListCommand } from "../../src/cli/cmd/memory"
import { ModelsCommand } from "../../src/cli/cmd/models"
import type { Agent } from "../../src/agent/agent"
import type { Session } from "../../src/session"

// Calls a command's yargs builder, then parses `--json` to prove the option is
// registered (a command that rejects `--json` would leave `argv.json` unset).
function builderAcceptsJson(builder: unknown): boolean {
  const fn = builder as ((args: Argv) => Argv) | undefined
  const parser = yargs([])
  fn?.(parser)
  const argv = parser.parseSync(["--json"])
  return argv.json === true
}

function agent(overrides: Record<string, unknown> = {}): Agent.Info {
  return {
    name: "agent",
    mode: "all",
    native: true,
    permission: [],
    options: {},
    ...overrides,
  } as unknown as Agent.Info
}

describe("providers list --json", () => {
  test("builds a single parseable providers document", () => {
    const doc = buildProvidersDocument({
      providers: {
        "ax-code": { name: "AX Code", models: { a: {}, b: {} } },
        anthropic: { name: "Anthropic", models: { "claude-sonnet-4": {} } },
        custom: {},
      },
      connected: ["ax-code"],
      management: { "ax-code": "ax-trust" },
    })

    expect(doc).toHaveProperty("providers")
    expect(Array.isArray(doc.providers)).toBe(true)
    expect(() => JSON.parse(JSON.stringify(doc))).not.toThrow()
  })

  test("sorts ax-code first and maps connected/management/models", () => {
    const doc = buildProvidersDocument({
      providers: {
        anthropic: { name: "Anthropic", models: { m1: {} } },
        "ax-code": { name: "AX Code", models: { m1: {}, m2: {} } },
        custom: {},
      },
      connected: ["ax-code"],
      management: { "ax-code": "ax-trust" },
    })

    expect(doc.providers.map((p) => p.id)).toEqual(["ax-code", "anthropic", "custom"])

    const axCode = doc.providers[0]
    expect(axCode.connected).toBe(true)
    expect(axCode.management).toBe("ax-trust")
    expect(axCode.models).toBe(2)

    const anthropic = doc.providers.find((p) => p.id === "anthropic")!
    expect(anthropic.connected).toBe(false)
    expect(anthropic.models).toBe(1)
    expect(anthropic.management).toBeUndefined()

    const custom = doc.providers.find((p) => p.id === "custom")!
    expect(custom.name).toBe("custom")
    expect(custom.models).toBe(0)
  })

  test("builder accepts --json", () => {
    expect(builderAcceptsJson(ProvidersListCommand.builder)).toBe(true)
  })
})

describe("agent list --json", () => {
  test("mirrors text sort (native first) and maps fields", () => {
    const doc = buildAgentsDocument([
      agent({ name: "explore", mode: "subagent", native: false, description: "Explore", tier: "specialist" }),
      agent({ name: "general", mode: "all", native: true }),
    ])

    expect(doc.agents.map((a) => a.name)).toEqual(["general", "explore"])
    const general = doc.agents[0]
    expect(general.builtIn).toBe(true)
    expect(general.mode).toBe("all")
    expect(general.description).toBeUndefined()

    const explore = doc.agents[1]
    expect(explore.builtIn).toBe(false)
    expect(explore.mode).toBe("subagent")
    expect(explore.description).toBe("Explore")
    expect(explore.tier).toBe("specialist")
    expect(() => JSON.parse(JSON.stringify(doc))).not.toThrow()
  })

  test("formats the model as provider/model when present", () => {
    const doc = buildAgentsDocument([agent({ model: { providerID: "p", modelID: "m" } })])
    expect(doc.agents[0].model).toBe("p/m")
  })

  test("builder accepts --json", () => {
    expect(builderAcceptsJson(AgentListCommand.builder)).toBe(true)
  })
})

describe("mcp list --json", () => {
  test("resolveMcpStatus maps status to the text-mode strings", () => {
    expect(resolveMcpStatus(undefined)).toEqual({ status: "not initialized", enabled: true })
    expect(resolveMcpStatus({ status: "connected" })).toEqual({ status: "connected", enabled: true })
    expect(resolveMcpStatus({ status: "disabled" })).toEqual({ status: "disabled", enabled: false })
    expect(resolveMcpStatus({ status: "needs_auth" })).toEqual({ status: "needs authentication", enabled: true })
    expect(resolveMcpStatus({ status: "failed", error: "boom" })).toEqual({
      status: "failed",
      enabled: true,
      error: "boom",
    })
  })

  test("builds a servers document with tools only when requested", () => {
    const doc = buildMcpDocument({
      servers: [
        { name: "a", type: "local", status: { status: "connected" }, tools: 3 },
        { name: "b", type: "remote", status: { status: "failed", error: "boom" } },
      ],
      includeTools: true,
    })

    expect(doc.servers).toHaveLength(2)
    expect(doc.servers[0]).toEqual({ name: "a", type: "local", status: "connected", enabled: true, tools: 3 })
    expect(doc.servers[1]).toEqual({
      name: "b",
      type: "remote",
      status: "failed",
      enabled: true,
      tools: 0,
      error: "boom",
    })

    const withoutTools = buildMcpDocument({
      servers: [{ name: "a", type: "local", status: { status: "connected" }, tools: 3 }],
    })
    expect(withoutTools.servers[0]).not.toHaveProperty("tools")
  })

  test("builder accepts --json", () => {
    expect(builderAcceptsJson(McpListCommand.builder)).toBe(true)
  })
})

describe("mcp auth list --json", () => {
  test("maps auth status text and url", () => {
    const doc = buildMcpAuthDocument({
      servers: [
        { name: "s1", status: "authenticated", url: "https://a" },
        { name: "s2", status: "not_authenticated", url: "https://b" },
      ],
    })
    expect(doc.servers).toEqual([
      { name: "s1", status: "authenticated", url: "https://a" },
      { name: "s2", status: "not authenticated", url: "https://b" },
    ])
    expect(() => JSON.parse(JSON.stringify(doc))).not.toThrow()
  })

  test("redacts credentials embedded in server URLs", () => {
    // A URL with userinfo (e.g. https://user:token@host/mcp) must never leak
    // the credential into --json output; the redaction replaces userinfo with
    // *** and leaves the rest of the URL intact.
    expect(redactUrlCredentials("https://user:secret@example.com/mcp")).toBe("https://***@example.com/mcp")
    expect(redactUrlCredentials("https://token@example.com/mcp")).toBe("https://***@example.com/mcp")
    // URLs without credentials come back verbatim — including non-canonical
    // spellings that a URL round-trip would normalize.
    expect(redactUrlCredentials("https://example.com/mcp")).toBe("https://example.com/mcp")
    expect(redactUrlCredentials("https://a")).toBe("https://a")
    expect(redactUrlCredentials("not a url")).toBe("not a url")
    // The document builder applies the same redaction per server.
    const doc = buildMcpAuthDocument({
      servers: [
        { name: "creds", status: "authenticated", url: "https://user:secret@example.com/mcp" },
        { name: "plain", status: "authenticated", url: "https://example.com/mcp" },
      ],
    })
    expect(doc.servers).toEqual([
      { name: "creds", status: "authenticated", url: "https://***@example.com/mcp" },
      { name: "plain", status: "authenticated", url: "https://example.com/mcp" },
    ])
    // The credential never survives anywhere in the serialized document.
    expect(JSON.stringify(doc)).not.toContain("secret")
  })

  test("builder accepts --json", () => {
    expect(builderAcceptsJson(McpAuthListCommand.builder)).toBe(true)
  })
})

describe("stats --json", () => {
  test("exposes the text-mode numbers with no dollar fields", () => {
    const doc = buildStatsDocument({
      totalSessions: 2,
      totalMessages: 10,
      totalTokens: { input: 100, output: 50, reasoning: 10, cache: { read: 20, write: 5 } },
      toolUsage: { bash: 3, read: 7 },
      modelUsage: {
        "p/m": { messages: 4, tokens: { input: 60, output: 30, cache: { read: 10, write: 2 } } },
      },
      dateRange: { earliest: 0, latest: 1 },
      days: 5,
      tokensPerSession: 55,
      medianTokensPerSession: 40,
    })

    expect(doc.sessions).toBe(2)
    expect(doc.messages).toBe(10)
    expect(doc.days).toBe(5)
    expect(doc.tokens).toEqual({ input: 100, output: 50, reasoning: 10, cacheRead: 20, cacheWrite: 5 })
    expect(doc.tokensPerSession).toBe(55)
    expect(doc.medianTokensPerSession).toBe(40)
    expect(doc.tools).toEqual({ bash: 3, read: 7 })
    expect(doc.models["p/m"]).toEqual({ messages: 4, input: 60, output: 30, cacheRead: 10, cacheWrite: 2 })
    // ADR-084: no cost/dollar field may ever appear.
    expect(JSON.stringify(doc)).not.toMatch(/"cost"/i)
    expect(() => JSON.parse(JSON.stringify(doc))).not.toThrow()
  })

  test("builder accepts --json", () => {
    expect(builderAcceptsJson(StatsCommand.builder)).toBe(true)
  })

  test("large-dataset notice stays off stdout under --json (G7)", async () => {
    // The pure decision: no notice at or below the 1000-session threshold,
    // the original text above it.
    expect(statsLargeDatasetNotice(0)).toBeUndefined()
    expect(statsLargeDatasetNotice(1000)).toBeUndefined()
    expect(statsLargeDatasetNotice(1001)).toBe("Large dataset detected (1001 sessions). This may take a while...")

    // The routing pin: under --json the notice goes to stderr so stdout is a
    // single JSON document; text mode keeps the stdout notice.
    const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/stats.ts"), "utf-8")
    expect(src).toContain("if (options?.json) process.stderr.write(notice + EOL)")
    expect(src).toContain("else console.log(notice)")
    expect(src).not.toContain("console.log(`Large dataset detected")
    expect(src).toContain("await aggregateSessionStats(args.days, args.project, { json: args.json === true })")
  })
})

describe("context --json", () => {
  test("builds the token breakdown as numbers", () => {
    const session = { id: "sess_1", title: "Test" } as unknown as Session.Info
    const doc = buildContextDocument({
      session,
      messages: 3,
      toolCalls: 1,
      provider: "anthropic",
      model: "claude-sonnet-4",
      tokens: { input: 10, output: 5, reasoning: 2, cached: 1 },
    })

    expect(doc).toEqual({
      session: "sess_1",
      title: "Test",
      provider: "anthropic",
      model: "claude-sonnet-4",
      messages: 3,
      toolCalls: 1,
      tokens: { input: 10, output: 5, reasoning: 2, cached: 1 },
    })
    expect(() => JSON.parse(JSON.stringify(doc))).not.toThrow()
  })

  test("falls back to untitled and null provider/model", () => {
    const session = { id: "sess_2", title: "" } as unknown as Session.Info
    const doc = buildContextDocument({
      session,
      messages: 0,
      toolCalls: 0,
      provider: null,
      model: null,
      tokens: { input: 0, output: 0, reasoning: 0, cached: 0 },
    })
    expect(doc.title).toBe("untitled")
    expect(doc.provider).toBeNull()
    expect(doc.model).toBeNull()
  })

  test("builder accepts --json", () => {
    expect(builderAcceptsJson(ContextCommand.builder)).toBe(true)
  })
})

describe("audit --json coverage", () => {
  test("models, memory status and memory list accept --json", () => {
    expect(builderAcceptsJson(ModelsCommand.builder)).toBe(true)
    expect(builderAcceptsJson(MemoryStatusCommand.builder)).toBe(true)
    expect(builderAcceptsJson(MemoryListCommand.builder)).toBe(true)
  })
})
