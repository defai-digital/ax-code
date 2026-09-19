#!/usr/bin/env node
// Block `npm run <script>` (and yarn/bun equivalents) in this pnpm-only monorepo.
//
// The `preinstall: npx only-allow pnpm` hook only guards installs: `npm run dev`
// and friends never execute preinstall, so npm silently runs project scripts
// against an npm-managed node_modules that this repo's tooling (pnpm workspaces,
// catalog: dependencies, `pnpm -r` / `pnpm --dir` script bodies) does not
// support. npm runs a `pre<script>` lifecycle hook before every
// `npm run <script>`, which closes that gap. pnpm runs the same hooks, but its
// npm_config_user_agent starts with "pnpm/", so pnpm-driven workflows pass the
// check unchanged.
import { pathToFileURL } from "node:url"

/**
 * Whether the package manager that launched this process may run scripts here.
 * Detection matches only-allow/which-pm-runs: npm and pnpm both set
 * npm_config_user_agent for the scripts they execute (e.g.
 * "pnpm/10.33.4 npm/? node/v26.9.0 darwin arm64").
 */
export function resolvePnpmEnforcement(userAgent = process.env.npm_config_user_agent ?? "") {
  const used = userAgent.split("/")[0] || undefined
  return { allowed: used === "pnpm", used }
}

export function blockMessage(used) {
  return [
    `[only-allow-pnpm] This repository requires pnpm, but the command was run with ${used ? `"${used}"` : "an unrecognized package manager"}.`,
    "",
    "Run project commands with pnpm instead:",
    "  npm run <script>  ->  pnpm run <script>",
    "  npm install       ->  pnpm install",
    "",
    "pnpm workspaces, catalog: dependencies, and the pnpm -r / pnpm --dir",
    "script bodies in package.json do not work under other package managers.",
  ].join("\n")
}

// CLI entry — skipped when the test suite imports this module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const verdict = resolvePnpmEnforcement()
  if (!verdict.allowed) {
    console.error(blockMessage(verdict.used))
    process.exit(1)
  }
}
