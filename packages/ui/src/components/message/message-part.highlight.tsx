import { createMemo, For } from "solid-js"
import { AgentPart, FilePart } from "@ax-code/sdk/v2"

type HighlightSegment = { text: string; type?: "file" | "agent" }

export const highlightSegments = (text: string, references: FilePart[], agents: AgentPart[]) => {
  const allRefs: { start: number; end: number; type: "file" | "agent" }[] = [
    ...references
      .filter((r) => r.source?.text?.start !== undefined && r.source?.text?.end !== undefined)
      .map((r) => ({ start: r.source!.text!.start, end: r.source!.text!.end, type: "file" as const })),
    ...agents
      .filter((a) => a.source?.start !== undefined && a.source?.end !== undefined)
      .map((a) => ({ start: a.source!.start, end: a.source!.end, type: "agent" as const })),
  ].sort((a, b) => a.start - b.start)

  const result: HighlightSegment[] = []
  let lastIndex = 0

  for (const ref of allRefs) {
    if (ref.start < lastIndex) continue
    if (ref.start > lastIndex) {
      result.push({ text: text.slice(lastIndex, ref.start) })
    }
    result.push({ text: text.slice(ref.start, ref.end), type: ref.type })
    lastIndex = ref.end
  }

  if (lastIndex < text.length) {
    result.push({ text: text.slice(lastIndex) })
  }

  return result
}

export function HighlightedText(props: { text: string; references: FilePart[]; agents: AgentPart[] }) {
  const segments = createMemo(() => highlightSegments(props.text, props.references, props.agents))
  return <For each={segments()}>{(segment) => <span data-highlight={segment.type}>{segment.text}</span>}</For>
}
