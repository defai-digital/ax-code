import { createHash, randomUUID } from "node:crypto"
import z from "zod"
import { Instance } from "@/project/instance"
import { NamedError } from "@ax-code/util/error"
import { MessageID, SessionID } from "./schema"

export namespace SessionSteering {
  export const Input = z
    .object({
      expectedGeneration: z.string().uuid(),
      clientID: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
      text: z.string().trim().min(1).max(16_000),
    })
    .strict()
  export type Input = z.infer<typeof Input>
  export const Receipt = z
    .object({
      sessionID: SessionID.zod,
      generation: z.string().uuid(),
      clientID: z.string(),
      status: z.enum(["accepted", "applied", "rejected"]),
      messageID: MessageID.zod.optional(),
      reason: z.string().optional(),
    })
    .meta({ ref: "SteeringReceipt" })
  export type Receipt = z.infer<typeof Receipt>
  export const View = z
    .object({
      generation: z.string().uuid().nullable(),
      receipts: Receipt.array(),
      retention: z.literal("process-local; at most 256 receipts per session"),
    })
    .meta({ ref: "SteeringState" })
  export const Conflict = NamedError.create("SteeringConflict", z.object({ message: z.string() }))
  type Pending = { digest: string; text?: string; receipt: Receipt; admitted: boolean; ready: Promise<void> }
  type Entry = { active?: { generation: string; signal: AbortSignal }; receipts: Map<string, Pending> }
  const state = Instance.state(() => new Map<SessionID, Entry>())

  function entry(sessionID: SessionID) {
    const entries = state()
    let result = entries.get(sessionID)
    if (!result) {
      if (entries.size >= 256) {
        const retired = [...entries].find(([, value]) => !value.active)
        if (!retired) throw new Conflict({ message: "Steering session capacity reached" })
        entries.delete(retired[0])
      }
      result = { receipts: new Map() }
      entries.set(sessionID, result)
    }
    return result
  }

  export function begin(sessionID: SessionID, signal: AbortSignal) {
    finish(sessionID)
    // Receipt capacity must never prevent an ordinary prompt from starting.
    if (!state().has(sessionID) && state().size >= 256 && [...state().values()].every((item) => item.active)) return
    entry(sessionID).active = { generation: randomUUID(), signal }
  }

  export function finish(sessionID: SessionID) {
    const current = state().get(sessionID)
    if (!current) return
    current.active = undefined
    for (const pending of current.receipts.values()) {
      if (pending.receipt.status !== "accepted") continue
      pending.receipt.status = "rejected"
      pending.receipt.reason = "generation_ended_before_application"
      pending.text = undefined
    }
  }

  export function view(sessionID: SessionID): z.infer<typeof View> {
    const current = state().get(sessionID)
    return {
      generation: current?.active && !current.active.signal.aborted ? current.active.generation : null,
      receipts: [...(current?.receipts.values() ?? [])]
        .filter((item) => item.admitted)
        .map((item) => ({ ...item.receipt })),
      retention: "process-local; at most 256 receipts per session",
    }
  }

  export async function submit(sessionID: SessionID, input: Input, beforeAccept: () => Promise<void>) {
    const request = Input.parse(input)
    const current = entry(sessionID)
    const digest = createHash("sha256").update(JSON.stringify(request)).digest("hex")
    const existing = current.receipts.get(request.clientID)
    if (existing) {
      if (existing.digest !== digest)
        throw new Conflict({ message: "Client ID already identifies different steering content" })
      await existing.ready
      return { ...existing.receipt }
    }
    if ([...current.receipts.values()].filter((item) => item.receipt.status === "accepted").length >= 32)
      throw new Conflict({ message: "Steering queue capacity reached" })
    if (current.receipts.size >= 256) {
      const retired = [...current.receipts].find(([, item]) => item.admitted && item.receipt.status !== "accepted")
      if (!retired) throw new Conflict({ message: "Steering receipt capacity reached" })
      current.receipts.delete(retired[0])
    }
    let release!: () => void
    const pending: Pending = {
      digest,
      text: request.text,
      admitted: false,
      ready: new Promise<void>((resolve) => {
        release = resolve
      }),
      receipt: { sessionID, generation: request.expectedGeneration, clientID: request.clientID, status: "accepted" },
    }
    current.receipts.set(request.clientID, pending)
    const matches = () =>
      current.active?.generation === request.expectedGeneration &&
      !current.active.signal.aborted &&
      pending.receipt.status === "accepted"
    try {
      if (!matches()) throw new Error("generation_not_active")
      await beforeAccept()
      if (!matches()) throw new Error("generation_ended_during_admission")
    } catch {
      const reason = matches() ? "admission_rejected" : "generation_not_active"
      pending.receipt.status = "rejected"
      // Do not reflect hook stdout or potentially sensitive exception payloads.
      pending.receipt.reason = reason
      pending.text = undefined
    } finally {
      pending.admitted = true
      release()
    }
    return { ...pending.receipt }
  }

  export function hasPending(sessionID: SessionID, signal: AbortSignal) {
    const current = state().get(sessionID)
    return (
      current?.active?.signal === signal &&
      !signal.aborted &&
      [...current.receipts.values()].some((item) => item.admitted && item.receipt.status === "accepted")
    )
  }

  export async function drain(
    sessionID: SessionID,
    signal: AbortSignal,
    apply: (input: {
      text: string
      messageID: MessageID
      beforeCommit(): void
      afterCommit(): void
    }) => Promise<unknown>,
  ) {
    const current = state().get(sessionID)
    if (!current?.active || current.active.signal !== signal || signal.aborted) return false
    const generation = current.active.generation
    const pending = [...current.receipts.values()].filter((item) => item.admitted && item.receipt.status === "accepted")
    let applied = false
    for (const item of pending) {
      const messageID = MessageID.ascending()
      try {
        await apply({
          text: item.text!,
          messageID,
          beforeCommit() {
            if (signal.aborted || current.active?.generation !== generation || item.receipt.status !== "accepted")
              throw new Error("Steering generation ended before durable admission")
          },
          afterCommit() {
            item.receipt.status = "applied"
            item.receipt.messageID = messageID
            item.text = undefined
            applied = true
          },
        })
      } catch (error) {
        // A notification failure after commit must not misreport saved text.
        if (item.receipt.status !== "applied") {
          item.receipt.status = "rejected"
          item.receipt.reason = "application_rejected"
          item.text = undefined
        } else throw error
      }
    }
    return applied
  }
}
