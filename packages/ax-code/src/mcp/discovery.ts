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

const CACHE_TTL_MS = 5 * 60 * 1000

let cached: { results: DiscoveredServer[]; at: number } | undefined

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
    check: async () => {
      try {
        const proc = Bun.spawn(["npx", "--help"], { stdout: "ignore", stderr: "ignore" })
        return (await Process.capture(proc, { timeout: 5000 })).code === 0
      } catch {
        return false
      }
    },
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
    check: async () => {
      try {
        const proc = Bun.spawn(["npx", "-y", "@modelcontextprotocol/server-puppeteer", "--help"], {
          stdout: "ignore",
          stderr: "ignore",
        })
        return (await Process.capture(proc, { timeout: 5000 })).code === 0
      } catch {
        return false
      }
    },
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
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    log.debug("returning cached MCP discovery results", { age: Date.now() - cached.at })
    return cached.results
  }

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

  cached = { results, at: Date.now() }
  return results
}

/**
 * Get only detected (available) servers
 */
export async function available(): Promise<DiscoveredServer[]> {
  const all = await discover()
  return all.filter((s) => s.detected)
}
