/**
 * MCP Server Templates
 * Ported from ax-cli's MCP template system
 *
 * Pre-configured MCP server definitions for popular tools.
 * Users select from this list instead of writing JSON config manually.
 */

export interface McpTemplate {
  name: string
  description: string
  category: string
  type: "local" | "remote"
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  envRequired?: string[]
  envDescription?: Record<string, string>
  docs?: string
}

export const TEMPLATES: McpTemplate[] = [
  // === Search & Web ===
  {
    name: "exa",
    description: "Web search and content retrieval via Exa.ai",
    category: "Search & Web",
    type: "remote",
    url: "https://mcp.exa.ai/mcp",
    envRequired: ["EXA_API_KEY"],
    envDescription: { EXA_API_KEY: "Get from https://exa.ai" },
    docs: "https://docs.exa.ai/mcp",
  },
  {
    name: "brave-search",
    description: "Web search via Brave Search API",
    category: "Search & Web",
    type: "local",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    envRequired: ["BRAVE_API_KEY"],
    envDescription: { BRAVE_API_KEY: "Get from https://brave.com/search/api/" },
  },

  // === Developer Tools ===
  {
    name: "github",
    description: "GitHub API — issues, PRs, repos, code search",
    category: "Developer Tools",
    type: "local",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    envRequired: ["GITHUB_TOKEN"],
    envDescription: { GITHUB_TOKEN: "Personal access token from https://github.com/settings/tokens" },
  },
  {
    name: "gitlab",
    description: "GitLab API — issues, merge requests, repos",
    category: "Developer Tools",
    type: "local",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-gitlab"],
    envRequired: ["GITLAB_TOKEN"],
    envDescription: { GITLAB_TOKEN: "Personal access token from GitLab settings" },
  },
  {
    name: "sentry",
    description: "Sentry error tracking — issues, events, traces",
    category: "Developer Tools",
    type: "local",
    command: "npx",
    args: ["-y", "@sentry/mcp-server"],
    envRequired: ["SENTRY_AUTH_TOKEN"],
    envDescription: { SENTRY_AUTH_TOKEN: "Get from https://sentry.io/settings/auth-tokens/" },
  },

  // === Databases ===
  {
    name: "postgres",
    description: "PostgreSQL database — query, schema, tables",
    category: "Databases",
    type: "local",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    envRequired: ["DATABASE_URL"],
    envDescription: { DATABASE_URL: "PostgreSQL connection string (e.g., postgresql://user:pass@host/db)" },
  },

  // === File System & Storage ===
  {
    name: "filesystem",
    description: "File system access — read, write, search files",
    category: "File System",
    type: "local",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
  },
  // === Browser & Testing ===
  {
    name: "puppeteer",
    description: "Browser automation — navigate, screenshot, interact",
    category: "Browser & Testing",
    type: "local",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
  },

  // === Cloud & Infrastructure ===
  {
    name: "vercel",
    description: "Vercel deployments — projects, domains, logs",
    category: "Cloud",
    type: "local",
    command: "npx",
    args: ["-y", "@vercel/mcp-adapter"],
    envRequired: ["VERCEL_TOKEN"],
    envDescription: { VERCEL_TOKEN: "Get from https://vercel.com/account/tokens" },
  },
  {
    name: "cloudflare",
    description: "Cloudflare Workers, KV, R2, DNS",
    category: "Cloud",
    type: "local",
    command: "npx",
    args: ["-y", "@cloudflare/mcp-server-cloudflare"],
    envRequired: ["CLOUDFLARE_API_TOKEN"],
    envDescription: { CLOUDFLARE_API_TOKEN: "Get from https://dash.cloudflare.com/profile/api-tokens" },
  },

  // === Communication ===
  {
    name: "slack",
    description: "Slack — read/send messages, search channels",
    category: "Communication",
    type: "local",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    envRequired: ["SLACK_BOT_TOKEN"],
    envDescription: { SLACK_BOT_TOKEN: "Bot token from https://api.slack.com/apps" },
  },
]

/**
 * Get all templates grouped by category
 */
export function byCategory(): Record<string, McpTemplate[]> {
  const groups: Record<string, McpTemplate[]> = {}
  for (const template of TEMPLATES) {
    if (!groups[template.category]) groups[template.category] = []
    groups[template.category].push(template)
  }
  return groups
}

/**
 * Find a template by name
 */
export function find(name: string): McpTemplate | undefined {
  return TEMPLATES.find((t) => t.name === name)
}

/**
 * Get template names for autocomplete
 */
export function names(): string[] {
  return TEMPLATES.map((t) => t.name)
}

/**
 * Convert a template to ax-code config format.
 *
 * The McpLocal schema expects `command` as a single string array
 * (binary + args) and uses `environment` (not `env`) for env vars.
 * The McpRemote schema expects `url` and optional `headers`/`oauth`.
 * Both schemas are `.strict()`, so extra keys cause validation errors.
 *
 * `environment` carries the values collected for the template's
 * `envRequired` vars (from process.env or the interactive prompt). It is
 * only applied to local servers — `McpRemote` has no `environment` field.
 */
export function toConfig(template: McpTemplate, environment?: Record<string, string>): Record<string, unknown> {
  const config: Record<string, unknown> = { type: template.type }
  if (template.type === "local") {
    // McpLocal.command is `string[]` — binary + args combined.
    const parts: string[] = []
    if (template.command) parts.push(template.command)
    if (template.args) parts.push(...template.args)
    if (parts.length > 0) config.command = parts
    // McpLocal uses `environment`, not `env`. Prefer the collected values
    // (envRequired), then fall back to any static `env` on the template.
    const env = environment ?? template.env
    if (env && Object.keys(env).length > 0) config.environment = env
  } else {
    // Remote: only `url` is relevant from the template fields.
    if (template.url) config.url = template.url
  }
  return config
}
