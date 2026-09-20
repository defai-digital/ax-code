import {
  claudeCodeParser,
  codexCliParser,
  grokBuildCliParser,
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
}

export function getCliProviderDefinition(providerID: string): CliProviderDefinition | undefined {
  return CLI_PROVIDER_DEFINITIONS[providerID]
}
