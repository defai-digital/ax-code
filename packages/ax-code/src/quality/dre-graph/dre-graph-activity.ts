export type DreGraphActivityTool = {
  name: string
  args: string
  status?: string
}

export function summarizeDreGraphActivityTools(tools: DreGraphActivityTool[]): string {
  const reads: string[] = []
  const edits: string[] = []
  let searches = 0
  let shells = 0
  let webs = 0
  let others = 0

  for (const tool of tools) {
    const name = tool.name.toLowerCase()
    const arg = basename(tool.args)
    if (/^(read|view|cat)$/.test(name)) reads.push(arg || tool.name)
    else if (/^(edit|write|apply_patch|multiedit|patch)$/.test(name)) edits.push(arg || tool.name)
    else if (/^(grep|glob|search|find|code_intelligence|semantic)/.test(name)) searches++
    else if (/^(bash|run|exec|shell|command)$/.test(name)) shells++
    else if (/^(web_fetch|web_search|fetch|browse)/.test(name)) webs++
    else others++
  }

  const parts: string[] = []
  if (reads.length)
    parts.push(reads.length <= 2 ? `read ${reads.filter(Boolean).join(", ")}` : `read ${reads.length} files`)
  if (edits.length)
    parts.push(edits.length <= 2 ? `edited ${edits.filter(Boolean).join(", ")}` : `edited ${edits.length} files`)
  if (searches) parts.push(`searched ${searches}×`)
  if (shells) parts.push(plural(shells, "ran {} command", "ran {} commands"))
  if (webs) parts.push(plural(webs, "fetched {} URL", "fetched {} URLs"))
  if (others) parts.push(`${others} misc`)
  return parts.join(" · ") || "no tool calls"
}

export function dreGraphActivityToolLabels(tools: Array<Pick<DreGraphActivityTool, "name">>, max = 5): string[] {
  const counts = new Map<string, number>()
  for (const tool of tools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
}

function basename(input: string) {
  return input ? (input.split("/").pop()?.split("\\").pop() ?? input) : ""
}

function plural(count: number, singular: string, plural: string) {
  return (count === 1 ? singular : plural).replace("{}", count.toString())
}
