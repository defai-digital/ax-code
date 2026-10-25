/** Direction is importer -> dependency. Weight is file-pair count, never runtime activity. */
export function dependencyMetrics(
  ids: readonly string[],
  edges: readonly { from: string; to: string; imports: number }[],
) {
  const state = new Map(
    ids.map((id) => [
      id,
      { incoming: new Set<string>(), outgoing: new Set<string>(), inboundPairs: 0, outboundPairs: 0 },
    ]),
  )
  for (const edge of edges) {
    const from = state.get(edge.from),
      to = state.get(edge.to)
    if (!from || !to || edge.from === edge.to) continue
    if (!Number.isSafeInteger(edge.imports) || edge.imports < 1) throw new Error("Invalid dependency weight")
    from.outgoing.add(edge.to)
    to.incoming.add(edge.from)
    from.outboundPairs += edge.imports
    to.inboundPairs += edge.imports
    if (!Number.isSafeInteger(from.outboundPairs) || !Number.isSafeInteger(to.inboundPairs))
      throw new Error("Dependency weight exceeds safe count")
  }
  return new Map(
    [...state].map(([id, value]) => [
      id,
      {
        inboundNeighbors: value.incoming.size,
        outboundNeighbors: value.outgoing.size,
        inboundPairs: value.inboundPairs,
        outboundPairs: value.outboundPairs,
      },
    ]),
  )
}
