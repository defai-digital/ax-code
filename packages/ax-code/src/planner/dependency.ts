/**
 * Dependency resolver using Kahn's topological sort
 * Ported from ax-cli's dependency-resolver.ts
 *
 * Resolves phase execution order based on dependencies,
 * groups independent phases into parallel batches
 */

import type { TaskPhase, ExecutionBatch } from "./types"

export interface ResolutionResult {
  success: boolean
  batches: ExecutionBatch[]
  error?: string
  criticalPath: string[]
}

/**
 * Resolve phase dependencies into ordered execution batches
 * Uses Kahn's algorithm for topological sort with batch grouping
 */
export function resolve(phases: TaskPhase[]): ResolutionResult {
  // Validate unique IDs
  const ids = new Set(phases.map((p) => p.id))
  if (ids.size !== phases.length) {
    return { success: false, batches: [], error: "Duplicate phase IDs detected", criticalPath: [] }
  }

  // Validate dependency references
  for (const phase of phases) {
    for (const dep of phase.dependencies) {
      if (!ids.has(dep)) {
        return { success: false, batches: [], error: `Phase "${phase.id}" depends on unknown phase "${dep}"`, criticalPath: [] }
      }
      if (dep === phase.id) {
        return { success: false, batches: [], error: `Phase "${phase.id}" depends on itself`, criticalPath: [] }
      }
    }
  }

  // Build adjacency list and in-degree map
  const adjacency = new Map<string, string[]>()
  const inDegree = new Map<string, number>()
  const phaseMap = new Map<string, TaskPhase>()

  for (const phase of phases) {
    adjacency.set(phase.id, [])
    inDegree.set(phase.id, 0)
    phaseMap.set(phase.id, phase)
  }

  for (const phase of phases) {
    for (const dep of phase.dependencies) {
      // Validate that the referenced phase exists before pushing.
      // Previously `adjacency.get(dep)!` crashed with a cryptic
      // "Cannot read properties of undefined (reading 'push')" when
      // a phase declared a misspelled or missing dependency. Fail
      // loudly with a message that points at the actual mistake.
      const deps = adjacency.get(dep)
      if (!deps) {
        throw new Error(`Phase "${phase.id}" depends on unknown phase "${dep}"`)
      }
      deps.push(phase.id)
      inDegree.set(phase.id, (inDegree.get(phase.id) ?? 0) + 1)
    }
  }

  // Kahn's algorithm with batch grouping
  const batches: ExecutionBatch[] = []
  const processed = new Set<string>()

  while (processed.size < phases.length) {
    // Find all phases with no pending dependencies
    const ready: TaskPhase[] = []
    for (const phase of phases) {
      if (processed.has(phase.id)) continue
      if ((inDegree.get(phase.id) ?? 0) === 0) {
        ready.push(phase)
      }
    }

    if (ready.length === 0) {
      return { success: false, batches: [], error: "Circular dependency detected", criticalPath: [] }
    }

    // Group into batch
    const parallel = ready.length > 1 && ready.every((p) => p.canRunInParallel)
    batches.push({
      phases: ready,
      canRunInParallel: parallel,
      estimatedTokens: 0,
    })

    // Mark processed and update in-degrees
    for (const phase of ready) {
      processed.add(phase.id)
      for (const dependent of adjacency.get(phase.id) ?? []) {
        inDegree.set(dependent, (inDegree.get(dependent) ?? 0) - 1)
      }
    }
  }

  return {
    success: true,
    batches,
    criticalPath: criticalPath(phases),
  }
}

/**
 * Get phases that are ready to execute given completed phases
 */
export function ready(phases: TaskPhase[], completed: Set<string>): TaskPhase[] {
  return phases.filter((p) => {
    if (p.status !== "pending") return false
    return p.dependencies.every((dep) => completed.has(dep))
  })
}

/**
 * Find the critical path (longest dependency chain)
 */
function criticalPath(phases: TaskPhase[]): string[] {
  const phaseMap = new Map(phases.map((p) => [p.id, p]))
  const memo = new Map<string, string[]>()

  function longest(id: string): string[] {
    if (memo.has(id)) return memo.get(id)!
    const phase = phaseMap.get(id)
    if (!phase || phase.dependencies.length === 0) {
      const result = [id]
      memo.set(id, result)
      return result
    }

    let best: string[] = []
    for (const dep of phase.dependencies) {
      const path = longest(dep)
      if (path.length > best.length) best = path
    }

    const result = [...best, id]
    memo.set(id, result)
    return result
  }

  let critical: string[] = []
  for (const phase of phases) {
    const path = longest(phase.id)
    if (path.length > critical.length) critical = path
  }

  return critical
}
