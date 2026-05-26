/**
 * MCP Server Auto-Discovery
 * Ported from ax-cli's automatosx-auto-discovery.ts
 *
 * Detects locally installed MCP servers and returns their configurations.
 * Checks common locations: npx packages, local binaries, running services.
 */

import path from "path"
import net from "net"
import { access, readFile, constants } from "fs/promises"
import { Log } from "../util/log"
import { Process } from "../util/process"
import { Env } from "../util/env"

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
  // Process.spawn now enforces hard timeouts directly.
  let proc: ReturnType<typeof Process.spawn> | undefined
  try {
    proc = Process.spawn([command, ...args], {
      stdout: "ignore",
      stderr: "ignore",
      timeout: timeoutMs,
      env: Env.sanitize(),
    })
    const code = await proc.exited
    return code === 0
  } catch {
    if (proc && proc.exitCode === null && proc.signalCode === null) {
      await Process.killProcessTree(proc).catch(() => {})
    }
    return false
  }
}

/**
 * Probe a TCP port with a short timeout. Used to detect Chrome CDP.
 * Exported for unit tests.
 */
export function checkTcpPort(port: number, host = "127.0.0.1", timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const done = (result: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once("connect", () => done(true))
    socket.once("error", () => done(false))
    socket.once("timeout", () => done(false))
    socket.connect(port, host)
  })
}

/**
 * Detect whether the given directory looks like an HTML/web project.
 * Checks: index.html, index.htm, src/app, app directories, or a
 * playwright dependency in package.json.
 * Exported for unit tests.
 */
export async function isHtmlOrWebProject(cwd: string): Promise<boolean> {
  const fileExists = (p: string) =>
    access(p, constants.F_OK)
      .then(() => true)
      .catch(() => false)

  if (await fileExists(path.join(cwd, "index.html"))) return true
  if (await fileExists(path.join(cwd, "index.htm"))) return true
  // web-app directory signals (mirrors analyzer.ts detectProjectType)
  if (await fileExists(path.join(cwd, "src/app"))) return true
  if (await fileExists(path.join(cwd, "app"))) return true

  // playwright dependency in package.json
  try {
    const raw = await readFile(path.join(cwd, "package.json"), "utf8")
    const pkg = JSON.parse(raw) as Record<string, unknown>
    const allDeps = {
      ...((pkg.dependencies as Record<string, unknown>) ?? {}),
      ...((pkg.devDependencies as Record<string, unknown>) ?? {}),
    }
    if ("playwright" in allDeps || "@playwright/test" in allDeps) return true
  } catch {
    // no package.json or parse error — not a web project by this signal
  }

  return false
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
  // Optional: compute final args after check() passes. Allows runtime
  // configuration (e.g. CDP vs headless) without changing the Candidate
  // base shape or breaking existing candidates.
  resolveArgs?: () => Promise<string[]>
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
      spawnExitsCleanly("npx", ["-y", "@modelcontextprotocol/server-puppeteer", "--help"], { timeoutMs: 5000 }),
  },
  {
    name: "playwright",
    description: "Browser screenshot and automation for HTML/web development",
    type: "stdio",
    command: "npx",
    // Default args — resolveArgs() below overrides these at discovery time
    // based on whether Chrome is running with CDP on port 9222.
    args: ["-y", "@playwright/mcp@latest"],
    check: async () => {
      const cwd = process.cwd()
      return (await isHtmlOrWebProject(cwd)) && (await spawnExitsCleanly("npx", ["--help"]))
    },
    resolveArgs: async () => {
      const cdpOpen = await checkTcpPort(9222)
      return cdpOpen
        ? ["-y", "@playwright/mcp@latest", "--cdp-url", "http://localhost:9222"]
        : ["-y", "@playwright/mcp@latest", "--browser", "chromium", "--headless"]
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
  log.info("starting MCP auto-discovery")
  const results: DiscoveredServer[] = []

  const checks = await Promise.allSettled(
    CANDIDATES.map(async (candidate) => {
      try {
        const detected = await candidate.check()
        // Resolve dynamic args only when the candidate is actually detected
        const args = detected && candidate.resolveArgs ? await candidate.resolveArgs() : candidate.args
        return { candidate, detected, args }
      } catch {
        return { candidate, detected: false, args: candidate.args }
      }
    }),
  )

  for (const result of checks) {
    if (result.status !== "fulfilled") continue
    const { candidate, detected, args } = result.value

    results.push({
      name: candidate.name,
      description: candidate.description,
      type: candidate.type,
      command: candidate.command || undefined,
      args: args.length > 0 ? args : undefined,
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
