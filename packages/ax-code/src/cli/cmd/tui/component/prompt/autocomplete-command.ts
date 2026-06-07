export function commandAutocompleteSuffix(command: { source?: string; workflow?: string }) {
  if (command.workflow) return ":workflow"
  if (command.source === "mcp") return ":mcp"
  if (command.source === "skill") return ":skill"
  if (command.source === "file") return ":file"
  return ""
}
