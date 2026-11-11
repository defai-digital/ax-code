import { Config } from "@/config/config"
import { Isolation } from "@/isolation"
import { Context } from "@/util/context"
import { CLI_ISOLATION_UNSUPPORTED_ERROR_NAME, cliIsolationUnsupportedMessage } from "./isolation-error"
import { kimiReadOnlyAgentPath } from "./kimi-isolation"

/**
 * AX Code's isolation mode is a ceiling for every vendor CLI provider: the
 * vendor runs its own agent loop and tools, so a restricted AX session must
 * restrict the CLI's permissions too. A CLI that cannot express the requested
 * mode is rejected before it is spawned rather than silently run wider.
 *
 * This is a permanent configuration failure: every retry resends the same
 * unsupported provider/mode pair. `isRetryable` mirrors that at the provider
 * layer so `MessageV2.fromError` preserves it as a terminal API error instead
 * of collapsing it to `UnknownError`.
 */
export class CliIsolationUnsupportedError extends Error {
  readonly isRetryable = false

  constructor(providerID: string, mode: Isolation.Mode) {
    super(cliIsolationUnsupportedMessage(CLI_ISOLATION_LABELS[providerID] ?? providerID, mode))
    this.name = CLI_ISOLATION_UNSUPPORTED_ERROR_NAME
  }
}

const CLI_ISOLATION_LABELS: Record<string, string> = {
  "kimi-cli": "Kimi Code CLI",
  "muse-cli": "Muse Code CLI",
}

/** How to shape the definition's argv for the effective isolation mode. */
export interface CliIsolationArgs {
  /** Arguments to append after the provider's base args and optional args. */
  args: string[]
  /** Replace the value that follows `flag` in the base args (never duplicate it). */
  replace?: { flag: string; value: string }
}

// The session-effective mode is provided around provider work so an attached
// server honors a stricter per-request isolation policy. Direct calls (the
// connect probe, auxiliary model calls) fall back to the instance resolver.
const modeContext = Context.create<Isolation.Mode>("cli.isolation.mode")

export function provideCliIsolationMode<T>(mode: Isolation.Mode, fn: () => T): T {
  return modeContext.provide(mode, fn)
}

export function currentCliIsolationMode(): Isolation.Mode | undefined {
  return modeContext.peek()
}

/** Effective isolation ceiling for a CLI spawn in the current context. */
export function resolveCliIsolationMode(): Isolation.Mode {
  return currentCliIsolationMode() ?? Isolation.resolveMode(Config.peek()?.isolation)
}

/**
 * Map an isolation mode onto one CLI provider's argv.
 *
 * `full-access` preserves each CLI's headless defaults (Claude Code keeps its
 * autonomous-only bypass). Restricted modes add or replace safety flags, and
 * an unsupported provider/mode combination throws before spawning.
 */
export function cliIsolationArgs(providerID: string, mode: Isolation.Mode, autonomous: boolean): CliIsolationArgs {
  if (mode === "full-access") {
    return { args: providerID === "claude-code" && autonomous ? ["--dangerously-skip-permissions"] : [] }
  }

  if (mode === "read-only") {
    switch (providerID) {
      case "claude-code":
        return { args: ["--permission-mode", "dontAsk", "--tools", "Read,Glob,Grep"] }
      case "codex-cli":
        return { args: ["--sandbox", "read-only"] }
      case "grok-build-cli":
        return { args: ["--permission-mode", "plan"] }
      case "dsh-cli":
        // dsh's definition defaults to workspace-write; replace that value so
        // exactly one --permission-mode reaches the CLI.
        return { args: [], replace: { flag: "--permission-mode", value: "read-only" } }
      case "kimi-cli":
        // Verified live: `kimi -p` rejects --plan/--yolo/--auto, but
        // `--agent-file` loads an agent definition whose exact, case-sensitive
        // `tools:` allowlist limits the run to Read/Glob/Grep. startProcess
        // writes the file before spawn; `--agent-file` precedes `-p`.
        return { args: ["--agent-file", kimiReadOnlyAgentPath()] }
      case "muse-cli":
        // Verified live: `muse exec` accepts --disable-write (no non-shell
        // workspace writes) and --disable-shell (no shell execution). Together
        // they enforce read-only while Muse's own sandbox stays on.
        return { args: ["--disable-write", "--disable-shell"] }
      default:
        return { args: [] }
    }
  }

  switch (providerID) {
    case "claude-code":
      return { args: ["--permission-mode", "acceptEdits"] }
    case "codex-cli":
      return { args: ["--sandbox", "workspace-write"] }
    case "kimi-cli":
      // Verified live: `kimi -p` writes files outside the workspace (including
      // the home directory); Kimi has no sandbox to constrain them.
      throw new CliIsolationUnsupportedError(providerID, mode)
    // grok-build-cli, muse-cli, and dsh-cli already run at workspace-write.
    default:
      return { args: [] }
  }
}
