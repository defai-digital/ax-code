import {
  codexCliParser,
  grokBuildCliParser,
  kimiCliParser,
  minimaxCliParser,
  dshCliParser,
  type CliOutputParser,
} from "./parser"

export interface CliProviderDefinition {
  binary: string
  args: string[]
  parser: CliOutputParser
  promptMode: "stdin" | "arg" | "positional" | "file"
  promptFlag?: string
  workspaceArg?: string
}

export const CLI_PROVIDER_DEFINITIONS: Record<string, CliProviderDefinition> = {
  "codex-cli": {
    binary: "codex",
    args: ["exec", "--json", "--skip-git-repo-check"],
    parser: codexCliParser,
    promptMode: "stdin",
  },
  "grok-build-cli": {
    binary: "grok",
    args: [],
    parser: grokBuildCliParser,
    promptMode: "file",
    promptFlag: "--prompt-file",
  },
  // Kimi Code CLI (membership): non-interactive -p/--prompt mode with stream-json JSONL.
  // Note: Kimi does not accept Claude's --print flag; -p itself enables headless mode.
  "kimi-cli": {
    binary: "kimi",
    args: ["--output-format", "stream-json"],
    parser: kimiCliParser,
    promptMode: "arg",
    promptFlag: "-p",
  },
  // MiniMax Code CLI: headless exec with stream-json. Stdin via --input -
  // avoids argv limits. Permission is full because AX Code cannot show MCode's
  // interactive approval UI. Do not confuse with mmx-cli (platform CLI).
  "minimax-cli": {
    binary: "mcode",
    args: ["exec", "--output-format", "stream-json", "--permission", "full", "--prompt-mode", "coding", "--input", "-"],
    parser: minimaxCliParser,
    promptMode: "stdin",
    workspaceArg: "--cwd",
  },
  // DeepSeek Harness: one-shot headless profile with NDJSON events. The task
  // arrives on stdin (dsh reads stdin when the positional task is omitted).
  // workspace-write keeps edits inside the session workspace; approval never
  // rejects calls that would need dsh's interactive prompt. dsh uses the
  // invoking directory as its workspace, so no workspace flag exists. The
  // privacy `--patch` launcher flag is prepended in buildCliCommand.
  "dsh-cli": {
    binary: "dsh",
    args: ["--profile", "headless", "--json", "--permission-mode", "workspace-write", "--approval-policy", "never"],
    parser: dshCliParser,
    promptMode: "stdin",
  },
}

export function getCliProviderDefinition(providerID: string): CliProviderDefinition | undefined {
  // Own keys only: an inherited name such as "constructor" is not a CLI provider.
  return Object.hasOwn(CLI_PROVIDER_DEFINITIONS, providerID) ? CLI_PROVIDER_DEFINITIONS[providerID] : undefined
}
