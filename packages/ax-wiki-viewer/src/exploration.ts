import type { WikiGraphEdge, WikiGraphNode } from "@ax-code/ax-wiki/graph"
import { deriveHierarchy } from "./hierarchy.js"

export type Relationship = "all" | "citations" | "imports"
export type LocalScope = { root: string; hops: 1 | 2 }

export function matchesRelationship(edge: Pick<WikiGraphEdge, "kind">, relationship: Relationship): boolean {
  return relationship === "all" || edge.kind === (relationship === "citations" ? "references-source" : "uses")
}

/** Undirected exploration of admitted evidence only. Hidden nodes cannot bridge two visible nodes. */
export function localNeighborhood(
  nodes: readonly Pick<WikiGraphNode, "id">[],
  edges: readonly Pick<WikiGraphEdge, "from" | "to" | "kind">[],
  scope: LocalScope,
  relationship: Relationship,
): Set<string> {
  const known = new Set(nodes.map((node) => node.id))
  const found = new Set<string>()
  if (!known.has(scope.root)) return found
  found.add(scope.root)
  let frontier = new Set(found)
  for (let hop = 0; hop < scope.hops; hop++) {
    const next = new Set<string>()
    for (const edge of edges) {
      if (!known.has(edge.from) || !known.has(edge.to) || !matchesRelationship(edge, relationship)) continue
      if (frontier.has(edge.from) && !found.has(edge.to)) next.add(edge.to)
      if (frontier.has(edge.to) && !found.has(edge.from)) next.add(edge.from)
    }
    for (const id of next) found.add(id)
    frontier = next
  }
  return found
}

/** Sharing counts distinct citing pages, never imports, symbols, or omitted references. */
export function citationSummary(input: {
  nodes: readonly Pick<WikiGraphNode, "id" | "kind">[]
  edges: readonly Pick<WikiGraphEdge, "from" | "to" | "kind">[]
}) {
  const { groups } = deriveHierarchy(input, { x: 0, y: 0 })
  const kinds = new Map(input.nodes.map((node) => [node.id, node.kind]))
  const citingPages = new Map<string, Set<string>>()
  const citedSources = new Map<string, Set<string>>()
  for (const edge of input.edges) {
    if (edge.kind !== "references-source" || kinds.get(edge.from) !== "page" || kinds.get(edge.to) !== "source")
      continue
    if (!citingPages.has(edge.to)) citingPages.set(edge.to, new Set())
    if (!citedSources.has(edge.from)) citedSources.set(edge.from, new Set())
    citingPages.get(edge.to)!.add(edge.from)
    citedSources.get(edge.from)!.add(edge.to)
  }
  const pages = new Map<string, { placed: number; admitted: number; shared: number }>()
  for (const group of groups) {
    if (!group.head) continue
    const sources = citedSources.get(group.head) ?? new Set<string>()
    pages.set(group.head, {
      placed: group.sources.length,
      admitted: sources.size,
      shared: [...sources].filter((id) => (citingPages.get(id)?.size ?? 0) > 1).length,
    })
  }
  return { pages, citingPages }
}
