import type { Message, Part, SessionStatus } from "@ax-code/sdk/v2"
import type { TranscriptBlock } from "./block-format"
import { unknownErrorMessage } from "../util/error-message"
import { singleLine } from "./block-format"
import { DEFAULT_INLINE_TEXT, type InlineText } from "./markers"

export type TranscriptSnapshot = {
  sessionID: string
  messages: readonly Message[]
  parts: Record<string, Part[]>
  status?: SessionStatus
  error?: unknown
  revert?: string
  /** Part-level revert: the boundary message stays, cut before this part. */
  revertPart?: string
  requests?: readonly { id: string; kind: "permission" | "question" }[]
}

/** Stateful dedupe around a pure store projection; no SDK calls or terminal writes. */
// Dedupe only needs keys for messages the sync store can still hold (at most
// MAX_LOADED_SESSION_MESSAGES per session), so both memories are bounded and
// evict oldest-first instead of growing for the life of the process.
export const MAX_COMMITTED_KEYS = 20_000
export const MAX_TRACKED_REVERTS = 64

function remember<K, V>(map: Map<K, V>, key: K, value: V, max: number) {
  map.delete(key)
  map.set(key, value)
  while (map.size > max) map.delete(map.keys().next().value as K)
}

export function createTranscriptProjector(text: InlineText = DEFAULT_INLINE_TEXT) {
  const committed = new Map<string, true>()
  const reverts = new Map<string, string | undefined>()
  let session: string | undefined
  let transition = 0
  return {
    project(input: TranscriptSnapshot): TranscriptBlock[] {
      const blocks: TranscriptBlock[] = []
      const add = (block: TranscriptBlock) => {
        if (committed.has(block.key)) return
        if (!block.progress) remember(committed, block.key, true, MAX_COMMITTED_KEYS)
        blocks.push(block)
      }
      const sid = input.sessionID
      if (session !== sid) {
        session = sid
        add({ key: `${sid}:switch:${++transition}`, kind: "marker", text: text.sessionMarker(sid) })
      }
      if (reverts.get(sid) !== input.revert) {
        remember(reverts, sid, input.revert, MAX_TRACKED_REVERTS)
        add({
          key: `${sid}:revert:${++transition}`,
          kind: "marker",
          text: text.revertMarker(input.revert ?? "current head"),
        })
      }
      let blocked = false
      for (const message of input.messages) {
        // Mirror the full-screen view (routes/session/revert.ts): a message
        // revert hides the boundary message, a part-level revert keeps it up
        // to the reverted part.
        const boundary = input.revert !== undefined && message.id === input.revert
        if (input.revert && message.id >= input.revert && !(boundary && input.revertPart)) break
        let parts = input.parts[message.id] ?? []
        if (boundary) {
          const cut = parts.findIndex((part) => part.id === input.revertPart)
          parts = cut === -1 ? [] : parts.slice(0, cut)
        }
        for (const part of parts) {
          const key = `${sid}:${message.id}:${part.id}`
          if (committed.has(key)) continue
          if (part.type === "text" || part.type === "reasoning") {
            if (part.type === "text" && (part.ignored || part.synthetic)) continue
            const done = message.role === "user" || part.time?.end !== undefined
            add({
              key,
              kind: message.role === "user" ? "user" : part.type === "reasoning" ? "reasoning" : "assistant",
              text: part.text,
              progress: !done,
            })
            if (!done) {
              blocked = true
              break
            }
          } else if (part.type === "tool") {
            const state = part.state
            if (state.status !== "completed" && state.status !== "error") {
              blocked = true
              break
            }
            add({
              key,
              kind: "tool",
              text: `[${state.status}] ${singleLine(part.tool)}: ${singleLine(state.status === "error" ? state.error : state.title)}`,
            })
          } else if (part.type === "compaction") {
            add({ key, kind: "marker", text: text.compactionMarker() })
          } else if (part.type === "file" && part.mime.startsWith("image/")) {
            add({ key, kind: "notice", text: text.imagePlaceholder(singleLine(part.filename ?? part.mime)) })
          } else if (part.type === "file" && message.role === "user") {
            add({ key, kind: "user", text: `[file: ${singleLine(part.filename ?? part.mime)}]` })
          }
        }
        if (blocked || boundary) break
        if (message.role === "assistant" && message.error) {
          const error = message.error
          add({
            key: `${sid}:${message.id}:error`,
            kind: "error",
            text: `Error: ${"message" in error.data ? singleLine(String(error.data.message)) : error.name}`,
          })
        }
      }
      if (input.error) {
        const text = singleLine(unknownErrorMessage(input.error))
        const turn = input.messages.findLast((message) => message.role === "user")?.id ?? "startup"
        add({ key: `${sid}:${turn}:error:${text}`, kind: "error", text: `Error: ${text}` })
      }
      if (!blocked && input.status?.type === "idle") {
        const user = input.messages.findLast((message) => message.role === "user")
        const replies = input.messages.filter(
          (message) => message.role === "assistant" && message.parentID === user?.id,
        )
        if (
          user &&
          replies.length &&
          replies.every((message) => message.role === "assistant" && message.time.completed !== undefined)
        ) {
          let incoming = 0,
            outgoing = 0,
            reasoning = 0
          for (const message of replies)
            if (message.role === "assistant") {
              incoming += message.tokens.input
              outgoing += message.tokens.output
              reasoning += message.tokens.reasoning
            }
          add({
            key: `${sid}:${user.id}:summary`,
            kind: "summary",
            text: `Tokens: ${incoming} input, ${outgoing} output, ${reasoning} reasoning`,
          })
        }
      }
      return blocks
    },
  }
}
