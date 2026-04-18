import { claudeCodeParser, codexCliParser, geminiCliParser, type CliOutputParser } from "./parser"

export interface CliProviderDefinition {
  binary: string
  args: string[]
  parser: CliOutputParser
  promptMode: "stdin" | "arg"
  promptFlag?: string
}

export const CLI_PROVIDER_DEFINITIONS: Record<string, CliProviderDefinition> = {
  "claude-code": {
    binary: "claude",
    args: ["--print", "--verbose", "--output-format", "stream-json"],
    parser: claudeCodeParser,
    promptMode: "stdin",
  },
  "gemini-cli": {
    binary: "gemini",
    args: ["--output-format", "stream-json"],
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
}

export function getCliProviderDefinition(providerID: string): CliProviderDefinition | undefined {
  return CLI_PROVIDER_DEFINITIONS[providerID]
}
