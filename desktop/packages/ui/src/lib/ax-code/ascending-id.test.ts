import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { Message, Part, Session } from "@ax-code/sdk/v2/client"
import { ascendingId } from "./client"
import { INITIAL_STATE, type State } from "@/sync/types"
import { Binary } from "@/sync/binary"
import { buildSessionMessageRecordsSnapshot } from "@/sync/sync-context"
import { projectTurnRecords } from "@/components/chat/lib/turns/projectTurnRecords"
import type { ChatMessageEntry } from "@/components/chat/lib/turns/types"

// Canonical server encoding — must stay in sync with packages/ax-code/src/id/id.ts
// (Identifier.create). Assistant-message ids are minted server-side with this scheme.
const SERVER_RANDOM = "serverabcdefgh" // 14 chars, stand-in for the random suffix
function serverAscendingId(ts: number, counter = 1): string {
  let now = BigInt(ts) * BigInt(0x1000) + BigInt(counter)
  const bytes = new Uint8Array(6)
  for (let i = 0; i < 6; i += 1) bytes[i] = Number((now >> BigInt(40 - 8 * i)) & BigInt(0xff))
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  return `msg_${hex}${SERVER_RANDOM}`
}

const T = 1782832736031

describe("client ascendingId ↔ server id cross-compatibility", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test("a client-minted id created later than a server id sorts after it", () => {
    // Assistant (server) id first, then a user (client) id 1s later.
    const assistant = serverAscendingId(T)
    vi.setSystemTime(T + 1000)
    const user = ascendingId("msg")

    // Later creation time must mean a lexicographically larger id, so the sync store
    // (sorted by id) keeps conversation order. The old client multiplier (0x10000)
    // packed the timestamp into different bytes and violated this.
    expect(user > assistant).toBe(true)
  })

  test("interleaved client/server ids keep conversation order when sorted by id", () => {
    vi.setSystemTime(T)
    const promptA = ascendingId("msg")
    const five = serverAscendingId(T + 30)
    vi.setSystemTime(T + 1000)
    const promptB = ascendingId("msg")
    const seven = serverAscendingId(T + 1030)
    vi.setSystemTime(T + 2000)
    const promptC = ascendingId("msg")
    const nine = serverAscendingId(T + 2030)

    const conversation = [promptA, five, promptB, seven, promptC, nine]
    const sorted = [...conversation].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    expect(sorted).toEqual(conversation)
  })
})

// End-to-end guard for issue #325: reverting the latest user message must not hide the
// assistant responses of earlier, non-reverted turns.
const userMsg = (id: string, created: number): Message =>
  ({ id, role: "user", sessionID: "ses_1", time: { created, completed: created } }) as unknown as Message
const asstMsg = (id: string, parentID: string, created: number): Message =>
  ({ id, role: "assistant", parentID, sessionID: "ses_1", time: { created, completed: created } }) as unknown as Message
const textPart = (id: string, messageID: string, text: string): Part =>
  ({ id, type: "text", messageID, sessionID: "ses_1", text }) as unknown as Part

describe("issue #325 — revert latest user message keeps earlier assistant replies", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test("earlier assistant turns stay grouped after reverting the latest turn", () => {
    vi.setSystemTime(T)
    const promptA = ascendingId("msg")
    const five = serverAscendingId(T + 30)
    vi.setSystemTime(T + 1000)
    const promptB = ascendingId("msg")
    const seven = serverAscendingId(T + 1030)
    vi.setSystemTime(T + 2000)
    const promptC = ascendingId("msg")
    const nine = serverAscendingId(T + 2030)

    const messages: Message[] = []
    for (const m of [
      userMsg(promptA, 1),
      asstMsg(five, promptA, 2),
      userMsg(promptB, 3),
      asstMsg(seven, promptB, 4),
      userMsg(promptC, 5),
      asstMsg(nine, promptC, 6),
    ]) {
      Binary.insert(messages, m, (x) => x.id)
    }

    const session = { id: "ses_1", revert: { messageID: promptC } } as unknown as Session
    const state: State = {
      ...INITIAL_STATE,
      session: [session],
      message: { ses_1: messages },
      part: {
        [promptA]: [textPart("prt_a", promptA, "QA revert A")],
        [five]: [textPart("prt_5", five, "five")],
        [promptB]: [textPart("prt_b", promptB, "QA revert B")],
        [seven]: [textPart("prt_7", seven, "seven")],
        [promptC]: [textPart("prt_c", promptC, "QA revert C")],
        [nine]: [textPart("prt_9", nine, "nine")],
      },
    }

    const snapshot = buildSessionMessageRecordsSnapshot(state, "ses_1")
    const projection = projectTurnRecords(snapshot.list as unknown as ChatMessageEntry[])
    const assistantIds = projection.turns.flatMap((t) => t.assistantMessageIds)

    // The two completed earlier turns keep their assistant replies; only the reverted
    // latest turn (promptC / nine) is hidden.
    expect(assistantIds).toContain(five)
    expect(assistantIds).toContain(seven)
    expect(assistantIds).not.toContain(nine)
  })
})
