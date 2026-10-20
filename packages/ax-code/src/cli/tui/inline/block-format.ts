export type TranscriptBlock = {
  key: string
  kind: "user" | "assistant" | "reasoning" | "tool" | "error" | "summary" | "marker" | "notice"
  text: string
  progress?: boolean
}

// Terminal control bytes from model/tool output must never become terminal commands.
export function safeText(text: string) {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "")
}
export function singleLine(text: string) {
  return safeText(text).replace(/\s+/g, " ").trim()
}

export function markdownText(text: string): string {
  let fence: string | undefined
  const lines: string[] = []
  for (const line of safeText(text).split("\n")) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (!fence && marker) {
      fence = marker[1]
      continue
    }
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && /^ {0,3}(`+|~+)\s*$/.test(line))
        fence = undefined
      else lines.push(line)
      continue
    }
    const code: string[] = []
    lines.push(
      line
        .replace(/(`+)(.*?)\1/g, (_match, _fence, text: string) => `\x00${code.push(text) - 1}\x00`)
        .replace(/^ {0,3}#{1,6}\s+/, "")
        .replace(/^>\s?/, "")
        .replace(/!?\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
        .replace(/(\*\*|__|~~)(.*?)\1/g, "$2")
        .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|[.,!?]|$)/g, "$1$2")
        .replace(/\x00(\d+)\x00/g, (_match, index: string) => code[Number(index)]),
    )
  }
  return lines.join("\n").trimEnd()
}

export function formatBlock(block: TranscriptBlock) {
  if (block.kind === "user") return `You: ${safeText(block.text)}`
  if (block.kind === "assistant") return markdownText(block.text)
  if (block.kind === "reasoning") return `Reasoning: ${markdownText(block.text)}`
  return safeText(block.text)
}
