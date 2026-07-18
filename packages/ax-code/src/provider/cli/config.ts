import {
  antigravityCliParser,
  claudeCodeParser,
  codexCliParser,
  geminiCliParser,
  grokBuildCliParser,
  kimiCliParser,
  qoderCliParser,
  type CliOutputParser,
} from "./parser"

export interface CliProviderDefinition {
  binary: string
  args: string[]
  parser: CliOutputParser
  promptMode: "stdin" | "arg" | "positional"
  promptFlag?: string
  workspaceArg?: string
}

export const CLI_PROVIDER_DEFINITIONS: Record<string, CliProviderDefinition> = {
  "claude-code": {
    binary: "claude",
    args: ["--print", "--verbose", "--output-format", "stream-json"],
    parser: claudeCodeParser,
    promptMode: "positional",
  },
  "gemini-cli": {
    binary: "gemini",
    args: ["--output-format", "stream-json", "--skip-trust"],
    parser: geminiCliParser,
    promptMode: "arg",
    promptFlag: "-p",
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
    promptMode: "arg",
    promptFlag: "-p",
  },
  "qoder-cli": {
    binary: "qodercli",
    args: ["--output-format", "stream-json"],
    parser: qoderCliParser,
    promptMode: "arg",
    promptFlag: "-p",
  },
  "antigravity-cli": {
    binary: "agy",
    args: [],
    parser: antigravityCliParser,
    promptMode: "arg",
    promptFlag: "-p",
    workspaceArg: "--add-dir",
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
}

export function getCliProviderDefinition(providerID: string): CliProviderDefinition | undefined {
  return CLI_PROVIDER_DEFINITIONS[providerID]
}
