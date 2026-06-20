import { beforeEach, describe, expect, test } from "vitest";
import type { Message, SessionStatus } from "@ax-code/sdk/v2/client"
import { INITIAL_STATE, type State } from "./types"
import { type MessageStreamState, updateStreamingState, useStreamingStore } from "./streaming"

const completedAt = (at: number): MessageStreamState => ({
  phase: "completed",
  startedAt: at,
  lastUpdateAt: at,
  completedAt: at,
})

const message = (id: string, role: "user" | "assistant"): Message => ({
  id,
  role,
} as unknown as Message)

const stateWithMessages = (messages: Message[], status: SessionStatus = { type: "busy" } as SessionStatus): State => ({
  ...INITIAL_STATE,
  session_status: {
    ses_1: status,
  },
  message: {
    ses_1: messages,
  },
})

describe("updateStreamingState", () => {
  beforeEach(() => {
    useStreamingStore.setState({
      streamingMessageIds: new Map(),
      messageStreamStates: new Map(),
      prefillSessionIds: new Set(),
    })
  })

  test("does not mark a previous assistant message as streaming during a new user turn", () => {
    updateStreamingState(stateWithMessages([
      message("msg_user_1", "user"),
      message("msg_assistant_1", "assistant"),
    ]))
    expect(useStreamingStore.getState().streamingMessageIds.get("ses_1")).toBe("msg_assistant_1")

    updateStreamingState(stateWithMessages([
      message("msg_user_1", "user"),
      message("msg_assistant_1", "assistant"),
      message("msg_user_2", "user"),
    ]))

    expect(useStreamingStore.getState().streamingMessageIds.get("ses_1")).toBeNull()
    expect(useStreamingStore.getState().messageStreamStates.get("msg_assistant_1")?.phase).toBe("completed")
  })

  test("tracks the trailing assistant message once it appears", () => {
    updateStreamingState(stateWithMessages([
      message("msg_user_1", "user"),
      message("msg_assistant_1", "assistant"),
    ]))
    updateStreamingState(stateWithMessages([
      message("msg_user_1", "user"),
      message("msg_assistant_1", "assistant"),
      message("msg_user_2", "user"),
    ]))
    expect(useStreamingStore.getState().streamingMessageIds.get("ses_1")).toBeNull()

    updateStreamingState(stateWithMessages([
      message("msg_user_1", "user"),
      message("msg_assistant_1", "assistant"),
      message("msg_user_2", "user"),
      message("msg_assistant_2", "assistant"),
    ]))

    expect(useStreamingStore.getState().streamingMessageIds.get("ses_1")).toBe("msg_assistant_2")
  })

  test("completes the streaming message when the session becomes idle", () => {
    updateStreamingState(stateWithMessages([
      message("msg_user_1", "user"),
      message("msg_assistant_1", "assistant"),
    ]))
    expect(useStreamingStore.getState().streamingMessageIds.get("ses_1")).toBe("msg_assistant_1")

    updateStreamingState(stateWithMessages([
      message("msg_user_1", "user"),
      message("msg_assistant_1", "assistant"),
    ], { type: "idle" } as SessionStatus))

    expect(useStreamingStore.getState().streamingMessageIds.get("ses_1")).toBeNull()
    expect(useStreamingStore.getState().messageStreamStates.get("msg_assistant_1")?.phase).toBe("completed")
  })

  test("keeps a still-prefilling session across a tick that writes the store for another reason", () => {
    // Tick 1: busy session with no messages → prefill.
    updateStreamingState(stateWithMessages([]))
    expect(useStreamingStore.getState().prefillSessionIds.has("ses_1")).toBe(true)

    // Seed a stale completed entry so the next tick's prune pass forces a store
    // write even though the prefill session itself didn't "change".
    useStreamingStore.setState((s) => ({
      messageStreamStates: new Map(s.messageStreamStates).set("msg_old", completedAt(Date.now() - 61_000)),
    }))

    // Tick 2: still busy, still no messages. The prune rewrites the store; the
    // still-prefilling session must not be dropped from prefillSessionIds.
    updateStreamingState(stateWithMessages([]))

    expect(useStreamingStore.getState().messageStreamStates.has("msg_old")).toBe(false)
    expect(useStreamingStore.getState().prefillSessionIds.has("ses_1")).toBe(true)
  })

  test("prunes completed stream states older than the retention window", () => {
    useStreamingStore.setState({
      streamingMessageIds: new Map(),
      messageStreamStates: new Map([["msg_old", completedAt(Date.now() - 61_000)]]),
    })

    // Any update tick runs the prune pass.
    updateStreamingState({ ...INITIAL_STATE })

    expect(useStreamingStore.getState().messageStreamStates.has("msg_old")).toBe(false)
  })

  test("keeps recently completed stream states within the retention window", () => {
    useStreamingStore.setState({
      streamingMessageIds: new Map(),
      messageStreamStates: new Map([["msg_recent", completedAt(Date.now() - 1_000)]]),
    })

    updateStreamingState({ ...INITIAL_STATE })

    expect(useStreamingStore.getState().messageStreamStates.get("msg_recent")?.phase).toBe("completed")
  })
})
