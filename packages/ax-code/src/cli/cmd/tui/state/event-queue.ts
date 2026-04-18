import type { Action } from "./actions"

export type EventQueueSnapshot = {
  pending: number
  dropped: number
  coalesced: number
  maxDepth: number
}

type DeltaAction = Extract<Action, { type: "part.delta.received" }>

function sameTarget(left: DeltaAction, right: DeltaAction) {
  return (
    left.sessionID === right.sessionID &&
    left.messageID === right.messageID &&
    left.partID === right.partID &&
    left.field === right.field
  )
}

export function createEventQueue(input: { maxDepth?: number } = {}) {
  const maxDepth = input.maxDepth ?? 128
  const items: DeltaAction[] = []
  let dropped = 0
  let coalesced = 0

  return {
    enqueue(action: DeltaAction) {
      const last = items.at(-1)
      if (last && sameTarget(last, action)) {
        items[items.length - 1] = {
          ...last,
          delta: last.delta + action.delta,
        }
        coalesced++
        return
      }
      if (items.length >= maxDepth) {
        items.shift()
        dropped++
      }
      items.push(action)
    },
    flush() {
      const next = items.slice()
      items.length = 0
      return next
    },
    snapshot(): EventQueueSnapshot {
      return {
        pending: items.length,
        dropped,
        coalesced,
        maxDepth,
      }
    },
  }
}
