/**
 * Shared resolution of "which ax-code to launch" and how to launch it.
 *
 * Used by both the chat backend (AxCodeServer spawns `ax-code serve`) and the
 * terminal commands (which send the launch command to an interactive shell).
 * Kept free of `vscode` imports so the resolution logic stays unit-testable.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

/**
 * Terminal tab title. Matches the TUI's own OSC 0 title write
 * (packages/ax-code/src/cli/cmd/tui/app.tsx) so the tab never falls back to
 * the launcher's process name ("node").
 */
export const TERMINAL_NAME = "AX Code"

export type AxCodeTarget =
  // Explicit axCode.binaryPath override — an installed binary to exec directly.
  | { kind: "binary"; command: string }
  // Monorepo dev checkout — run from TypeScript source under Node (tsx + the
  // OpenTUI Solid loader).
  | { kind: "dev"; entry: string; cwd: string }
  // Globally installed `ax-code`, resolved through the (enriched) PATH.
  | { kind: "path" }

/**
 * Resolution priority: explicit binaryPath → monorepo dev (requires both the
 * ax-code entry AND a pnpm-workspace.yaml root marker so an installed VSIX
 * with unrelated sibling dirs isn't misdetected) → PATH fallback.
 */
export function resolveAxCodeTarget(input: { binaryPath: string; extensionPath: string }): AxCodeTarget {
  if (input.binaryPath && fs.existsSync(input.binaryPath)) {
    return { kind: "binary", command: input.binaryPath }
  }

  const monorepoRoot = path.resolve(input.extensionPath, "..", "..")
  const entry = path.join(monorepoRoot, "packages", "ax-code", "src", "index-node-tui.ts")
  const marker = path.join(monorepoRoot, "pnpm-workspace.yaml")
  if (fs.existsSync(entry) && fs.existsSync(marker)) {
    return { kind: "dev", entry, cwd: path.join(monorepoRoot, "packages", "ax-code") }
  }

  return { kind: "path" }
}

/**
 * Node loader arguments for the dev (from-source) launcher, excluding the node
 * executable itself. Absolute loader paths: the process cwd is the user's
 * workspace, not ax-code, so bare specifiers would not resolve. tsx strips TS;
 * the Solid loader transforms OpenTUI JSX; TSX_TSCONFIG_PATH (see
 * terminalLaunchEnv) gives tsx the @/* aliases. Entry is index-node-tui.ts
 * (index.ts imports the Bun-only @opentui/solid/preload).
 */
export function devLauncherArgs(target: { entry: string; cwd: string }): string[] {
  return [
    "--experimental-ffi",
    "--disable-warning=ExperimentalWarning",
    "--import",
    pathToFileURL(createRequire(path.join(target.cwd, "package.json")).resolve("tsx")).href,
    "--import",
    pathToFileURL(path.resolve(target.cwd, "..", "..", "script", "solid-loader.mjs")).href,
    "--conditions=node",
    target.entry,
  ]
}

/** Extra environment the launch needs. Only the dev launcher needs anything. */
export function terminalLaunchEnv(target: AxCodeTarget): Record<string, string> {
  if (target.kind === "dev") {
    return { TSX_TSCONFIG_PATH: path.join(target.cwd, "tsconfig.json") }
  }
  return {}
}

export type AxCodeTerminalLaunch =
  | { kind: "direct"; shellPath: string; shellArgs: string[] }
  | { kind: "shell"; command: string }

/**
 * Build VS Code terminal launch options for the TUI (no `serve` args — that's
 * the chat backend's job). Explicit binaries and the source-mode Node launcher
 * run directly so paths with spaces work under every shell, including the
 * default Windows PowerShell profile. The PATH fallback intentionally runs in
 * the user's shell so its normal command resolution still applies.
 */
export function terminalLaunch(target: AxCodeTarget): AxCodeTerminalLaunch {
  switch (target.kind) {
    case "binary":
      return { kind: "direct", shellPath: target.command, shellArgs: [] }
    case "dev":
      return { kind: "direct", shellPath: process.execPath, shellArgs: devLauncherArgs(target) }
    case "path":
      return { kind: "shell", command: "ax-code" }
  }
}
