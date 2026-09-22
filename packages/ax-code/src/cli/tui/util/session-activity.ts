import { english, type Translate } from "../i18n"
import { createSessionTreeIndex, type SessionTreeIndex, type SessionTreeNode } from "./session-tree"
import type { PendingRequestRef } from "./pending-request-notices"

export type AttentionRequest = PendingRequestRef & { kind: "approval" | "question" }
export type RequestBuckets = Record<string, PendingRequestRef[] | undefined>
export type ActivityStatuses = Record<string, { type: string } | undefined>

function collectAttentionRequests(permissions: RequestBuckets, questions: RequestBuckets) {
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
  return unique
}

export function knownAttentionRequests(permissions: RequestBuckets, questions: RequestBuckets): AttentionRequest[] {
  return [...collectAttentionRequests(permissions, questions).values()].toSorted(
    (a, b) => a.kind.localeCompare(b.kind) || a.sessionID.localeCompare(b.sessionID) || a.id.localeCompare(b.id),
  )
}

/** Same count as knownAttentionRequests(...).length without the sort and spread. */
export function knownAttentionRequestCount(permissions: RequestBuckets, questions: RequestBuckets) {
  return collectAttentionRequests(permissions, questions).size
}

export function createSessionActivityIndex(input: {
  t?: Translate
  sessions: readonly SessionTreeNode[]
  statuses: ActivityStatuses
  permissions: RequestBuckets
  questions: RequestBuckets
  /** Precomputed knownAttentionRequests(permissions, questions); callers that
   *  build several indexes per change share one sorted list this way. */
  requests?: readonly AttentionRequest[]
  /** Prebuilt index over exactly `sessions` (the shared Sync memo for the
   *  full store list); callers indexing a filtered subset must omit it. */
  tree?: SessionTreeIndex
}) {
  const uiText = input.t ?? english
  const tree = input.tree ?? createSessionTreeIndex(input.sessions)
  const requests = input.requests ?? knownAttentionRequests(input.permissions, input.questions)
  const bySession = new Map<string, AttentionRequest[]>()
  for (const request of requests) {
    const list = bySession.get(request.sessionID) ?? []
    list.push(request)
    bySession.set(request.sessionID, list)
  }
  return {
    get(sessionID: string) {
      // One pass over the subtree: this runs once per visible navigation row
      // on every activity change, so avoid re-spreading and re-scanning the
      // same id set for each derived field.
      const members: { id: string; status: string | undefined }[] = []
      const pending: AttentionRequest[] = []
      let approvals = 0
      let retrying = false
      let working = false
      for (const id of tree.subtree(sessionID)) {
        const status = input.statuses[id]?.type
        members.push({ id, status })
        if (status === "retry") retrying = true
        if (status === "busy") working = true
        for (const request of bySession.get(id) ?? []) {
          pending.push(request)
          if (request.kind === "approval") approvals++
        }
      }
      const questions = pending.length - approvals
      // A sparse status snapshot is not evidence of idle. Only positive live
      // signals get row labels; no inferred Done/Idle badge is rendered.
      const label = approvals
        ? questions
          ? uiText("ui.approvalAndQuestionPending")
          : uiText("ui.approvalNeeded")
        : questions
          ? uiText("ui.questionPending")
          : retrying
            ? uiText("ui.retrying")
            : working
              ? uiText("ui.working")
              : undefined
      return { members, pending, label, working: working || retrying, attention: pending.length > 0 }
    },
  }
}
