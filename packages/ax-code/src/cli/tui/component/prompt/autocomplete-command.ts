export function commandAutocompleteSuffix(command: { source?: string; workflow?: string }) {
  if (command.workflow) return ":workflow"
  if (command.source === "mcp") return ":mcp"
  if (command.source === "skill") return ":skill"
  if (command.source === "file") return ":file"
  return ""
}

export const MERGE_AND_SYNC_GITHUB = "merge-and-sync-github"

/** Only the first, still-editable branch token gets completions. */
export function mergeTargetArgumentPrefix(value: string): string | undefined {
  const prefix = `/${MERGE_AND_SYNC_GITHUB} `
  if (!value.startsWith(prefix)) return undefined
  const argument = value.slice(prefix.length)
  if (/\s/.test(argument)) return undefined
  return argument
}

export function mergeTargetBranchMatches(branches: readonly string[], prefix: string): string[] {
  const lower = prefix.toLowerCase()
  const matches = branches.filter((branch) => branch.toLowerCase().startsWith(lower)).sort()
  if (matches.length === 1 && matches[0] === prefix) return []
  return matches.slice(0, 10)
}
