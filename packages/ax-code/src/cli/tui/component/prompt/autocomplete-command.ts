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
  // Enter takes the first row, and this command merges into and pushes that
  // branch, so rank by how closely each name matches what was typed: exact,
  // exact ignoring case, then case-sensitive and case-insensitive prefixes.
  const tier = (branch: string) =>
    branch === prefix ? 0 : branch.toLowerCase() === lower ? 1 : branch.startsWith(prefix) ? 2 : 3
  const matches = branches
    .filter((branch) => branch.toLowerCase().startsWith(lower))
    .sort((a, b) => tier(a) - tier(b) || (a < b ? -1 : a > b ? 1 : 0))
  if (matches.length === 1 && matches[0] === prefix) return []
  return matches.slice(0, 10)
}
