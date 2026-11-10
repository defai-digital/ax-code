import {
  claudeCodeParser,
  codexCliParser,
  grokBuildCliParser,
  kimiCliParser,
  minimaxCliParser,
  museCliParser,
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
  "claude-code": {
    binary: "claude",
    args: ["--print", "--verbose", "--output-format", "stream-json"],
    parser: claudeCodeParser,
    promptMode: "stdin",
  },
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
  // Muse Code CLI: headless exec with durable JSONL. Prompt file avoids argv
  // limits. Approval is disabled because AX Code cannot show Muse's TUI.
  "muse-cli": {
    binary: "muse",
    args: ["exec", "--json", "--approval-mode", "never", "--disable-approval", "--trust-workspace"],
    parser: museCliParser,
    promptMode: "file",
    promptFlag: "--prompt-file",
    workspaceArg: "--workspace",
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
}

export function getCliProviderDefinition(providerID: string): CliProviderDefinition | undefined {
  return CLI_PROVIDER_DEFINITIONS[providerID]
}
