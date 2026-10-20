import { TextRenderable, type CliRenderer } from "ax-tui"
import { formatBlock, type TranscriptBlock } from "./block-format"

/** Leave the last paragraph and any open fence mutable in the footer. */
export function settledTextLength(text: string) {
  let fence: string | undefined
  let settled = 0
  let offset = 0
  for (const line of text.split(/(?<=\n)/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && /^ {0,3}(`+|~+)\s*$/.test(line))
        fence = undefined
    }
    offset += line.length
    if (!fence && line.endsWith("\n") && (!line.trim() || marker)) settled = offset
  }
  return settled
}

export function createScrollbackStream(renderer: Pick<CliRenderer, "createScrollbackSurface">) {
  const offsets = new Map<string, number>()
  return {
    async write(block: TranscriptBlock) {
      const streamed = block.kind === "assistant" || block.kind === "reasoning"
      const start = offsets.get(block.key) ?? 0
      const end = block.progress ? settledTextLength(block.text) : block.text.length
      const text =
        streamed && end <= start
          ? ""
          : formatBlock({
              ...block,
              kind: streamed && start > 0 ? "assistant" : block.kind,
              text: streamed ? block.text.slice(start, end) : block.text,
            })
      if (text) {
        const surface = renderer.createScrollbackSurface({ startOnNewLine: true })
        try {
          surface.root.add(
            new TextRenderable(surface.renderContext, { content: text, width: "100%", wrapMode: "word" }),
          )
          await surface.settle()
          for (let row = 0; row < surface.height; row++) surface.commitRows(row, row + 1, { trailingNewline: true })
        } finally {
          surface.destroy()
        }
      }
      offsets.set(block.key, end)
      if (!block.progress) offsets.delete(block.key)
    },
    preview(block: TranscriptBlock) {
      return block.text.slice(settledTextLength(block.text))
    },
  }
}
