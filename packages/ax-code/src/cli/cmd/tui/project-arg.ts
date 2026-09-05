import path from "path"

// Issue #414: the default `$0 [project]` positional swallows mistyped
// subcommands (`ax-code config`, `ax-code snapshot`), which then fail deep in
// the TUI launcher with a confusing "Failed to change directory" error. A bare
// word that is not an existing path carries no directory semantics — treat it
// as an unknown command and point the user at the real command list instead.

let registered: readonly string[] = []

export function setKnownCommands(commands: readonly string[]) {
  registered = [...new Set(commands)].sort()
}

export function knownCommands(): readonly string[] {
  return registered
}

export function isBareCommandWord(arg: string): boolean {
  const trimmed = arg.trim()
  if (trimmed === "") return false
  if (trimmed === "." || trimmed === "..") return false
  if (trimmed === "~" || trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return false
  if (path.isAbsolute(trimmed) || /^[A-Za-z]:[\\/]/.test(trimmed)) return false
  if (trimmed.includes("/") || trimmed.includes("\\")) return false
  return true
}

export function formatUnknownCommandError(word: string, commands: readonly string[]): string {
  const available = commands.length > 0 ? commands.join(", ") : 'run "ax-code --help" to list the available commands'
  return [
    `Unknown command: ${word}`,
    `No directory named "${word}" exists here, so this looks like a mistyped command.`,
    `Available commands: ${available}`,
  ].join("\n")
}

export function unknownProjectError(
  project: string,
  exists: boolean,
  commands: readonly string[] = registered,
): string | undefined {
  if (exists) return undefined
  if (!isBareCommandWord(project)) return undefined
  return formatUnknownCommandError(project, commands)
}
