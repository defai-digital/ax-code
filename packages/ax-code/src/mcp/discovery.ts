/**
 * MCP Server Auto-Discovery
 * Ported from ax-cli's automatosx-auto-discovery.ts
 *
 * Detects locally installed MCP servers and returns their configurations.
 * Checks common locations: npx packages, local binaries, running services.
 */

import { Log } from "../util/log"
import { Process } from "../util/process"

const log = Log.create({ service: "mcp.discovery" })

// Capability probe: spawn a short-lived process and report whether it
// exits cleanly within the given budget. Used for "does this binary
// work on this machine" checks during MCP discovery.
//
// Routed through Process.spawn (cross-spawn under the hood) instead of
// Bun.spawn so the discovery path does not depend on bun-runtime APIs.
// Discovery runs on every TUI startup and any bun-specific spawn quirk
// would surface as an MCP regression.
// Exported for unit tests — the helper has timeout, error, and exit-code
// branches that are easier to exercise directly than via CANDIDATES.
export async function spawnExitsCleanly(
  command: string,
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<boolean> {
  const { timeoutMs = 5000 } = options
  // Process.spawn's `timeout` option is the SIGTERM→SIGKILL grace
  // period after an abort fires, not a wall-clock budget. We need
  // an explicit AbortController to actually cap how long the probe
  // can run end-to-end.
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  try {
    const proc = Process.spawn([command, ...args], {
      stdout: "ignore",
      stderr: "ignore",
      abort: abort.signal,
    })
    const code = await proc.exited
    return code === 0
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export interface DiscoveredServer {
  name: string
  description: string
  type: "stdio" | "http"
  command?: string
  args?: string[]
  url?: string
  detected: boolean
}

interface Candidate {
  name: string
  description: string
  type: "stdio" | "http"
  command: string
  args: string[]
  check: () => Promise<boolean>
}

const CANDIDATES: Candidate[] = [
  {
    name: "filesystem",
    description: "File system access via MCP",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
    check: () => spawnExitsCleanly("npx", ["--help"]),
  },
  {
    name: "github",
    description: "GitHub API access (issues, PRs, repos)",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    check: async () => !!process.env.GITHUB_TOKEN || !!process.env.GITHUB_PERSONAL_ACCESS_TOKEN,
  },
  {
    name: "postgres",
    description: "PostgreSQL database access",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    check: async () => !!process.env.DATABASE_URL || !!process.env.POSTGRES_URL,
  },
  {
    name: "puppeteer",
    description: "Browser automation via Puppeteer",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    check: () =>
      spawnExitsCleanly(
        "npx",
        ["-y", "@modelcontextprotocol/server-puppeteer", "--help"],
        { timeoutMs: 5000 },
      ),
  },
  {
    name: "exa",
    description: "Web search via Exa.ai",
    type: "http",
    command: "",
    args: [],
    check: async () => {
      try {
        const res = await fetch("https://mcp.exa.ai/mcp", {
          method: "OPTIONS",
          signal: AbortSignal.timeout(3000),
        })
        return res.status < 500
      } catch {
        return false
      }
    },
  },
]

/**
 * Discover available MCP servers on the local machine
 * Only returns servers that pass their detection check
 */
export async function discover(): Promise<DiscoveredServer[]> {
  log.info("starting MCP auto-discovery")
  const results: DiscoveredServer[] = []

  const checks = await Promise.allSettled(
    CANDIDATES.map(async (candidate) => {
      try {
        const detected = await candidate.check()
        return { candidate, detected }
      } catch {
        return { candidate, detected: false }
      }
    }),
  )

  for (const result of checks) {
    if (result.status !== "fulfilled") continue
    const { candidate, detected } = result.value

    results.push({
      name: candidate.name,
      description: candidate.description,
      type: candidate.type,
      command: candidate.command || undefined,
      args: candidate.args.length > 0 ? candidate.args : undefined,
      url: candidate.type === "http" ? `https://mcp.${candidate.name}.ai/mcp` : undefined,
      detected,
    })
  }

  log.info("MCP auto-discovery complete", {
    total: results.length,
    detected: results.filter((r) => r.detected).length,
  })

  return results
}

/**
 * Get only detected (available) servers
 */
export async function available(): Promise<DiscoveredServer[]> {
  const all = await discover()
  return all.filter((s) => s.detected)
}
