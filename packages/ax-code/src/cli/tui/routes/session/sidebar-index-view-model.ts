export type SidebarGraphIndexStatus = {
  nodeCount: number
  lastIndexedAt?: number | null
  state: "idle" | "indexing" | "failed"
  completed: number
  total: number
  error: string | null
}

export function sidebarGraphIndexStatusText(graph: SidebarGraphIndexStatus) {
  if (graph.state === "failed") return `index failed: ${graph.error ?? "unknown error"}`
  if (graph.state === "indexing") {
    if (graph.total === 0) return "scanning files..."
    return `indexing... (${graph.completed.toLocaleString()}/${graph.total.toLocaleString()})`
  }
  if (graph.nodeCount > 0) return `${graph.nodeCount.toLocaleString()} symbols indexed`
  if (graph.error) return graph.error
  if (graph.lastIndexedAt) return "index complete · no code symbols found in this scope"
  if (graph.total > 0 && graph.completed >= graph.total) return "index complete · no code symbols found in this scope"
  return "not indexed · run ax-code index"
}
