import { createSessionTreeIndex, type SessionTreeNode } from "./session-tree"
import type { PendingRequestRef } from "./pending-request-notices"

export type AttentionRequest = PendingRequestRef & { kind: "approval" | "question" }
export type RequestBuckets = Record<string, PendingRequestRef[] | undefined>
export type ActivityStatuses = Record<string, { type: string } | undefined>

export function knownAttentionRequests(permissions: RequestBuckets, questions: RequestBuckets): AttentionRequest[] {
  const unique = new Map<string, AttentionRequest>()
  for (const [kind, buckets] of [
    ["approval", permissions],
    ["question", questions],
  ] as const) {
    for (const list of Object.values(buckets)) {
      for (const request of list ?? []) {
        unique.set(`${kind}:${request.id}`, { id: request.id, sessionID: request.sessionID, kind })
      }
    }
  }
  return [...unique.values()].toSorted(
    (a, b) => a.kind.localeCompare(b.kind) || a.sessionID.localeCompare(b.sessionID) || a.id.localeCompare(b.id),
  )
}

export function createSessionActivityIndex(input: {
  sessions: readonly SessionTreeNode[]
  statuses: ActivityStatuses
  permissions: RequestBuckets
  questions: RequestBuckets
}) {
  const tree = createSessionTreeIndex(input.sessions)
  const requests = knownAttentionRequests(input.permissions, input.questions)
  const bySession = new Map<string, AttentionRequest[]>()
  for (const request of requests) {
    const list = bySession.get(request.sessionID) ?? []
    list.push(request)
    bySession.set(request.sessionID, list)
  }
  return {
    get(sessionID: string) {
      const ids = tree.subtree(sessionID)
      const members = [...ids].map((id) => ({ id, status: input.statuses[id]?.type }))
      const pending = [...ids].flatMap((id) => bySession.get(id) ?? [])
      const approvals = pending.filter((request) => request.kind === "approval").length
      const questions = pending.length - approvals
      const retrying = members.some((member) => member.status === "retry")
      const working = members.some((member) => member.status === "busy")
      // A sparse status snapshot is not evidence of idle. Only positive live
      // signals get row labels; no inferred Done/Idle badge is rendered.
      const label = approvals
        ? questions
          ? "Approval and question pending"
          : "Approval needed"
        : questions
          ? "Question pending"
          : retrying
            ? "Retrying"
            : working
              ? "Working"
              : undefined
      return { members, pending, label, working: working || retrying, attention: pending.length > 0 }
    },
  }
}
