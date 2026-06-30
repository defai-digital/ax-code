import { describe, expect, test, beforeEach, vi } from "vitest"
import type { PermissionRequest } from "@/types/permission"
import type { Message, Part } from "@ax-code/sdk/v2/client"
import { resolveResyncedSessionStatus, hasCompletedAssistantReply } from "./reconnect-recovery"

// Mock SDK client that records permission.reply / question.reply calls
const replyCalls: Array<{ method: string; params: Record<string, unknown> }> = []
const createSessionCalls: Array<{ client: "scoped" | "global"; params: Record<string, unknown> }> = []
type MockSessionCreateResult = {
  data?: { id: string; directory: unknown }
  error?: { message: string }
}

let configState: {
  isConnected: boolean
  hasEverConnected: boolean
  probeConnection: (options?: { timeoutMs?: number }) => Promise<boolean>
} = {
  isConnected: true,
  hasEverConnected: true,
  probeConnection: () => Promise.resolve(true),
}

function resetConfigState() {
  configState = {
    isConnected: true,
    hasEverConnected: true,
    probeConnection: () => Promise.resolve(true),
  }
}

// Configurable result for the session.messages refetch the accepted-prompt
// watchdog performs before fabricating a failure. Defaults to "server has
// nothing" so the watchdog falls through to the synthetic error.
let scopedMessagesResult: { data: Array<{ info: Message; parts?: Part[] }> } = { data: [] }
function resetScopedMessagesResult() {
  scopedMessagesResult = { data: [] }
}

const mockScopedClient = {
  permission: {
    reply: vi.fn((params: Record<string, unknown>) => {
      replyCalls.push({ method: "permission.reply", params })
      return Promise.resolve({ data: true })
    }),
  },
  session: {
    create: vi.fn((params: Record<string, unknown>): Promise<MockSessionCreateResult> => {
      createSessionCalls.push({ client: "scoped", params })
      return Promise.resolve({ data: { id: "ses_scoped", directory: params.directory } })
    }),
    messages: vi.fn(() => Promise.resolve(scopedMessagesResult)),
  },
  question: {
    reply: vi.fn((params: Record<string, unknown>) => {
      replyCalls.push({ method: "question.reply", params })
      return Promise.resolve({ data: true })
    }),
    reject: vi.fn((params: Record<string, unknown>) => {
      replyCalls.push({ method: "question.reject", params })
      return Promise.resolve({ data: true })
    }),
  },
}

const mockSdk = {
  session: {
    create: vi.fn((params: Record<string, unknown>): Promise<MockSessionCreateResult> => {
      createSessionCalls.push({ client: "global", params })
      return Promise.resolve({ data: { id: "ses_global", directory: params.directory } })
    }),
  },
  permission: {
    reply: vi.fn((params: Record<string, unknown>) => {
      replyCalls.push({ method: "permission.reply", params })
      return Promise.resolve({ data: true })
    }),
  },
  question: {
    reply: vi.fn((params: Record<string, unknown>) => {
      replyCalls.push({ method: "question.reply", params })
      return Promise.resolve({ data: true })
    }),
    reject: vi.fn((params: Record<string, unknown>) => {
      replyCalls.push({ method: "question.reject", params })
      return Promise.resolve({ data: true })
    }),
  },
}

// Mock axCodeClient singleton
vi.doMock("@/lib/ax-code/client", () => ({
  axCodeClient: {
    getScopedSdkClient: () => mockScopedClient,
    getDirectory: () => "/test/project",
    checkHealth: () => Promise.resolve(true),
  },
}))

// Mock useConfigStore
vi.doMock("@/stores/useConfigStore", () => ({
  useConfigStore: {
    getState: () => configState,
  },
}))

// Mock useSessionUIStore
vi.doMock("./session-ui-store", () => ({
  useSessionUIStore: {
    getState: () => ({
      getDirectoryForSession: (sessionId: string) => {
        if (sessionId === "session-a") return "/test/project"
        if (sessionId === "session-b") return "/other/project"
        return null
      },
      setCurrentSession: vi.fn(),
    }),
  },
}))

// Mock useInputStore (imported but not used in permission functions)
vi.doMock("./input-store", () => ({
  useInputStore: {},
}))

// Mock useGlobalSessionsStore (imported but not used in permission functions)
vi.doMock("@/stores/useGlobalSessionsStore", () => ({
  useGlobalSessionsStore: {
    getState: () => ({
      upsertSession: vi.fn(),
    }),
  },
}))

// Mock sync-refs (imported but not used in permission functions)
vi.doMock("./sync-refs", () => ({
  registerSessionDirectory: () => {},
}))

import { create, type StoreApi } from "zustand"
import { INITIAL_STATE } from "./types"
import type { DirectoryStore } from "./child-store"
import type { AxCodeClient } from "@ax-code/sdk/v2/client"

function createStore(permissions: Record<string, PermissionRequest[]>): StoreApi<DirectoryStore> {
  return create<DirectoryStore>()((set) => ({
    ...INITIAL_STATE,
    permission: permissions,
    patch: (partial) => set(partial),
    replace: (next) => set(next),
  }))
}

function createChildStores(entries: Array<[string, StoreApi<DirectoryStore>]>) {
  return {
    children: new Map(entries),
    ensureChild: (dir: string) => {
      const store = new Map(entries).get(dir)
      if (!store) throw new Error(`No store for ${dir}`)
      return store
    },
  } as unknown as import("./child-store").ChildStoreManager
}

// Each test re-imports "./session-actions" via dynamic import; reset the module
// registry first so the SUT's module-level state (acceptedPromptAt, watchdog
// timer maps) starts clean per test. Without this, a prior test's accepted
// prompt leaks in and the grace-window watchdog re-arms unboundedly (OOM).
beforeEach(() => {
  vi.resetModules()
})

describe("respondToPermission passes directory", () => {
  beforeEach(() => {
    replyCalls.length = 0
    resetConfigState()
  })

  test("passes directory from child store when permission is found", async () => {
    const permission: PermissionRequest = {
      id: "perm-1",
      sessionID: "session-a",
      permission: "bash",
      patterns: [],
      metadata: {},
      always: [],
    }

    const store = createStore({ "session-a": [permission] })
    const childStores = createChildStores([["/test/project", store]])

    const { setActionRefs, respondToPermission } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as AxCodeClient, childStores, () => "/test/project")

    await respondToPermission("session-a", "perm-1", "once")

    expect(replyCalls.length).toBe(1)
    expect(replyCalls[0].params.requestID).toBe("perm-1")
    expect(replyCalls[0].params.reply).toBe("once")
    expect(replyCalls[0].params.directory).toBe("/test/project")
  })

  test("passes directory from session mapping when permission not in store", async () => {
    const childStores = createChildStores([])

    const { setActionRefs, respondToPermission } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as AxCodeClient, childStores, () => "/test/project")

    await respondToPermission("session-b", "perm-2", "always")

    expect(replyCalls.length).toBe(1)
    expect(replyCalls[0].params.requestID).toBe("perm-2")
    expect(replyCalls[0].params.reply).toBe("always")
    expect(replyCalls[0].params.directory).toBe("/other/project")
  })

  test("passes directory from current directory as last resort", async () => {
    const childStores = createChildStores([])

    const { setActionRefs, respondToPermission } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as AxCodeClient, childStores, () => "/fallback/dir")

    await respondToPermission("unknown-session", "perm-3", "reject")

    expect(replyCalls.length).toBe(1)
    expect(replyCalls[0].params.requestID).toBe("perm-3")
    expect(replyCalls[0].params.reply).toBe("reject")
    expect(replyCalls[0].params.directory).toBe("/fallback/dir")
  })
})

describe("createSession passes directory", () => {
  beforeEach(() => {
    createSessionCalls.length = 0
    mockScopedClient.session.create.mockImplementation(
      (params: Record<string, unknown>): Promise<MockSessionCreateResult> => {
        createSessionCalls.push({ client: "scoped", params })
        return Promise.resolve({ data: { id: "ses_scoped", directory: params.directory } })
      },
    )
    mockSdk.session.create.mockImplementation(
      (params: Record<string, unknown>): Promise<MockSessionCreateResult> => {
        createSessionCalls.push({ client: "global", params })
        return Promise.resolve({ data: { id: "ses_global", directory: params.directory } })
      },
    )
  })

  test("uses a directory-scoped SDK client when a directory is provided", async () => {
    const { createSession, setActionRefs } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as AxCodeClient, createChildStores([]), () => "/current/project")

    const session = await createSession("Desktop session", "/selected/project", null)

    expect(session?.id).toBe("ses_scoped")
    expect(createSessionCalls).toEqual([
      {
        client: "scoped",
        params: {
          directory: "/selected/project",
          title: "Desktop session",
          parentID: undefined,
        },
      },
    ])
  })

  test("throws the SDK error message when session creation fails", async () => {
    mockScopedClient.session.create.mockImplementationOnce((params: Record<string, unknown>) => {
      createSessionCalls.push({ client: "scoped", params })
      return Promise.resolve({ error: { message: "Project directory is not accessible" } })
    })

    const { createSession, setActionRefs } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as AxCodeClient, createChildStores([]), () => "/current/project")

    await expect(createSession("Desktop session", "/selected/project", null)).rejects.toThrow(
      "Failed to create session: Project directory is not accessible",
    )
  })
})

describe("dismissPermission passes directory", () => {
  beforeEach(() => {
    replyCalls.length = 0
    resetConfigState()
  })

  test("passes directory and reply=reject", async () => {
    const permission: PermissionRequest = {
      id: "perm-10",
      sessionID: "session-a",
      permission: "edit",
      patterns: [],
      metadata: {},
      always: [],
    }

    const store = createStore({ "session-a": [permission] })
    const childStores = createChildStores([["/test/project", store]])

    const { setActionRefs, dismissPermission } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as AxCodeClient, childStores, () => "/test/project")

    await dismissPermission("session-a", "perm-10")

    expect(replyCalls.length).toBe(1)
    expect(replyCalls[0].params.requestID).toBe("perm-10")
    expect(replyCalls[0].params.reply).toBe("reject")
    expect(replyCalls[0].params.directory).toBe("/test/project")
  })
})

describe("respondToQuestion passes directory", () => {
  beforeEach(() => {
    replyCalls.length = 0
    resetConfigState()
  })

  test("passes directory to question.reply", async () => {
    const childStores = createChildStores([])

    const { setActionRefs, respondToQuestion } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as AxCodeClient, childStores, () => "/test/project")

    await respondToQuestion("session-a", "q-1", [["answer1"]])

    expect(replyCalls.length).toBe(1)
    expect(replyCalls[0].params.requestID).toBe("q-1")
    expect(replyCalls[0].params.directory).toBe("/test/project")
  })
})

describe("rejectQuestion passes directory", () => {
  beforeEach(() => {
    replyCalls.length = 0
    resetConfigState()
  })

  test("passes directory to question.reject", async () => {
    const childStores = createChildStores([])

    const { setActionRefs, rejectQuestion } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as AxCodeClient, childStores, () => "/test/project")

    await rejectQuestion("session-a", "q-2")

    expect(replyCalls.length).toBe(1)
    expect(replyCalls[0].params.requestID).toBe("q-2")
    expect(replyCalls[0].params.directory).toBe("/test/project")
  })
})

describe("optimisticSend responsiveness", () => {
  beforeEach(() => {
    replyCalls.length = 0
    resetConfigState()
  })

  test("inserts the optimistic user message before waiting for connection recovery", async () => {
    const store = createStore({})
    const childStores = createChildStores([["/test/project", store]])
    let sawOptimisticBeforeProbe = false

    configState = {
      isConnected: false,
      hasEverConnected: true,
      probeConnection: () => {
        sawOptimisticBeforeProbe = (store.getState().message["session-a"] ?? []).length === 1
        configState = {
          ...configState,
          isConnected: true,
        }
        return Promise.resolve(true)
      },
    }

    const { setActionRefs, setOptimisticRefs, optimisticSend } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as AxCodeClient, childStores, () => "/test/project")
    setOptimisticRefs(
      ({ sessionID, message, parts }) => {
        store.setState((state) => ({
          message: {
            ...state.message,
            [sessionID]: [...(state.message[sessionID] ?? []), message],
          },
          part: {
            ...state.part,
            [message.id]: parts,
          },
        }))
      },
      ({ sessionID, messageID }) => {
        store.setState((state) => {
          const messages = state.message[sessionID] ?? []
          const nextMessages = messages.filter((message) => message.id !== messageID)
          const nextPart = { ...state.part }
          delete nextPart[messageID]
          return {
            message: {
              ...state.message,
              [sessionID]: nextMessages,
            },
            part: nextPart,
          }
        })
      },
    )

    let sendSawOptimistic = false
    await optimisticSend({
      sessionId: "session-a",
      content: "hello",
      providerID: "provider",
      modelID: "model",
      send: (messageID) => {
        const state = store.getState()
        sendSawOptimistic = state.message["session-a"]?.some((message: Message) => message.id === messageID) ?? false
        expect(state.part[messageID]?.some((part: Part) => part.type === "text")).toBe(true)
        return Promise.resolve()
      },
    })

    expect(sawOptimisticBeforeProbe).toBe(true)
    expect(sendSawOptimistic).toBe(true)
    expect(store.getState().session_status["session-a"]).toEqual({ type: "busy" })
  })

  test("adds a visible fallback when an accepted prompt goes idle without assistant output", async () => {
    resetScopedMessagesResult()
    const originalSetTimeout = globalThis.setTimeout
    // Fire callbacks synchronously, but advance a fake clock by each timer's
    // delay. The watchdog re-arms while the prompt is "recently accepted"
    // (Date.now() within the grace window); without advancing the clock the
    // re-arm never expires and recurses until OOM. Advancing past the grace
    // window lets the watchdog fall through to fabricating the fallback.
    let fakeNow = Date.now()
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => fakeNow)
    globalThis.setTimeout = ((callback: TimerHandler, ms?: number) => {
      fakeNow += typeof ms === "number" ? ms : 0
      if (typeof callback === "function") (callback as () => void)()
      return 0 as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout

    try {
      const store = createStore({})
      const childStores = createChildStores([["/test/project", store]])

      const { setActionRefs, setOptimisticRefs, optimisticSend } = await import("./session-actions")
      setActionRefs(mockSdk as unknown as AxCodeClient, childStores, () => "/test/project")
      setOptimisticRefs(
        ({ sessionID, message, parts }) => {
          store.setState((state) => ({
            message: {
              ...state.message,
              [sessionID]: [...(state.message[sessionID] ?? []), message],
            },
            part: {
              ...state.part,
              [message.id]: parts,
            },
          }))
        },
        ({ sessionID, messageID }) => {
          store.setState((state) => {
            const messages = state.message[sessionID] ?? []
            const nextMessages = messages.filter((message) => message.id !== messageID)
            const nextPart = { ...state.part }
            delete nextPart[messageID]
            return {
              message: {
                ...state.message,
                [sessionID]: nextMessages,
              },
              part: nextPart,
            }
          })
        },
      )

      await optimisticSend({
        sessionId: "session-a",
        content: "hello",
        providerID: "provider",
        modelID: "model",
        send: () => {
          store.setState((state) => ({
            session_status: {
              ...state.session_status,
              "session-a": { type: "idle" as const },
            },
          }))
          return Promise.resolve()
        },
      })

      // The watchdog now verifies against the server before fabricating, so the
      // synthetic fallback is injected after the (empty) refetch resolves.
      await new Promise((resolve) => originalSetTimeout(resolve, 0))

      const messages = store.getState().message["session-a"] ?? []
      const fallback = messages.find((message) => message.role === "assistant")
      expect(fallback).toBeTruthy()
      expect((fallback as (Message & { metadata?: Record<string, unknown> }) | undefined)?.metadata?.source).toBe(
        "desktop-accepted-prompt-watchdog",
      )
      expect((fallback as (Message & { metadata?: Record<string, unknown> }) | undefined)?.metadata?.error).toBe(true)
      expect(store.getState().part[fallback?.id ?? ""]?.[0]?.type).toBe("text")
    } finally {
      globalThis.setTimeout = originalSetTimeout
      nowSpy.mockRestore()
    }
  })

  test("recovers a server-side response instead of fabricating a failure", async () => {
    resetScopedMessagesResult()
    const originalSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = ((callback: TimerHandler) => {
      if (typeof callback === "function") callback()
      return 0 as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout

    try {
      const store = createStore({})
      const childStores = createChildStores([["/test/project", store]])

      const { setActionRefs, setOptimisticRefs, optimisticSend } = await import("./session-actions")
      setActionRefs(mockSdk as unknown as AxCodeClient, childStores, () => "/test/project")
      setOptimisticRefs(
        ({ sessionID, message, parts }) => {
          store.setState((state) => ({
            message: {
              ...state.message,
              [sessionID]: [...(state.message[sessionID] ?? []), message],
            },
            part: {
              ...state.part,
              [message.id]: parts,
            },
          }))
        },
        () => {},
      )

      await optimisticSend({
        sessionId: "session-a",
        content: "hello",
        providerID: "provider",
        modelID: "model",
        send: (messageID) => {
          // Simulate a turn whose streamed events were dropped: the session
          // goes idle locally, but the server actually has the assistant reply.
          scopedMessagesResult = {
            data: [
              {
                info: {
                  id: messageID,
                  sessionID: "session-a",
                  role: "user",
                  time: { created: 1 },
                } as unknown as Message,
                parts: [],
              },
              {
                info: {
                  id: "msg_assistant",
                  sessionID: "session-a",
                  role: "assistant",
                  parentID: messageID,
                  time: { created: 2, completed: 3 },
                } as unknown as Message,
                parts: [
                  {
                    id: "prt_assistant",
                    type: "text",
                    messageID: "msg_assistant",
                    text: "real reply",
                  } as unknown as Part,
                ],
              },
            ],
          }
          store.setState((state) => ({
            session_status: {
              ...state.session_status,
              "session-a": { type: "idle" as const },
            },
          }))
          return Promise.resolve()
        },
      })

      await new Promise((resolve) => originalSetTimeout(resolve, 0))

      const messages = store.getState().message["session-a"] ?? []
      const synthetic = messages.find(
        (message) =>
          (message as Message & { metadata?: Record<string, unknown> }).metadata?.source ===
          "desktop-accepted-prompt-watchdog",
      )
      expect(synthetic).toBeFalsy()
      const recovered = messages.find((message) => message.role === "assistant")
      expect(recovered?.id).toBe("msg_assistant")
      expect(store.getState().part["msg_assistant"]?.[0]?.type).toBe("text")
    } finally {
      globalThis.setTimeout = originalSetTimeout
    }
  })
})

describe("optimisticSend: stale watchdog from previous prompt is cancelled (stale-watchdog fix)", () => {
  // Regression test for the bug where the 1st prompt's 12s watchdog fired
  // DURING the 2nd prompt's turn, found the 1st prompt's completed assistant
  // reply, saw the 2nd prompt's busy status, and incorrectly forced idle —
  // clobbering the 2nd turn and tripping its own watchdog to fabricate the
  // "no assistant response" error.
  //
  // Root cause: scheduleAcceptedPromptWatchdog used globalThis.setTimeout but
  // never stored or cancelled the timer. Each new prompt leaked a stale
  // watchdog for the previous prompt.

  const setupOptimistic = async (store: ReturnType<typeof createStore>) => {
    const childStores = createChildStores([["/test/project", store]])
    const { setActionRefs, setOptimisticRefs, optimisticSend } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as AxCodeClient, childStores, () => "/test/project")
    setOptimisticRefs(
      ({ sessionID, message, parts }) => {
        store.setState((state) => ({
          message: {
            ...state.message,
            [sessionID]: [...(state.message[sessionID] ?? []), message],
          },
          part: { ...state.part, [message.id]: parts },
        }))
      },
      ({ sessionID, messageID }) => {
        store.setState((state) => {
          const messages = state.message[sessionID] ?? []
          const nextPart = { ...state.part }
          delete nextPart[messageID]
          return {
            message: { ...state.message, [sessionID]: messages.filter((m) => m.id !== messageID) },
            part: nextPart,
          }
        })
      },
    )
    return { optimisticSend }
  }

  test("cancels the stale watchdog when a new prompt is sent for the same session", async () => {
    // Timer mock: store callbacks so we can fire them manually.
    const originalSetTimeout = globalThis.setTimeout
    const originalClearTimeout = globalThis.clearTimeout
    const timers = new Map<number, () => void>()
    let nextTimerId = 1

    globalThis.setTimeout = ((callback: () => void) => {
      const id = nextTimerId++
      timers.set(id, callback)
      return id as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout

    globalThis.clearTimeout = ((id: unknown) => {
      timers.delete(id as number)
    }) as unknown as typeof clearTimeout

    try {
      const store = createStore({})
      const { optimisticSend } = await setupOptimistic(store)

      // 1st prompt
      let firstMessageId = ""
      await optimisticSend({
        sessionId: "session-a",
        content: "first prompt",
        providerID: "provider",
        modelID: "model",
        send: (messageID) => {
          firstMessageId = messageID
          return Promise.resolve()
        },
      })

      // At this point exactly 1 timer should exist (the 1st prompt's watchdog)
      expect(timers.size).toBe(1)

      // Simulate the 1st prompt completing: add assistant response + idle status
      store.setState((state) => ({
        session_status: {
          ...state.session_status,
          "session-a": { type: "idle" as const },
        },
        message: {
          ...state.message,
          "session-a": [
            ...(state.message["session-a"] ?? []),
            {
              id: "msg_first_assistant",
              role: "assistant",
              sessionID: "session-a",
              parentID: firstMessageId,
              time: { created: 1, completed: 2 },
            } as unknown as Message,
          ],
        },
      }))

      // 2nd prompt — should cancel the 1st prompt's watchdog
      await optimisticSend({
        sessionId: "session-a",
        content: "second prompt",
        providerID: "provider",
        modelID: "model",
        send: () => Promise.resolve(),
      })

      // The 1st watchdog was cancelled. Only 1 timer should remain (the 2nd's)
      expect(timers.size).toBe(1)

      // Status should be busy (from the 2nd prompt's optimistic set)
      expect(store.getState().session_status?.["session-a"]).toEqual({ type: "busy" })

      // Now manually fire ALL remaining timers (simulating the 12s timeout).
      // Only the 2nd prompt's watchdog should fire — the 1st was cancelled.
      const callbacks = [...timers.values()]
      for (const cb of callbacks) {
        await cb()
      }
      await new Promise((resolve) => originalSetTimeout(resolve, 0))

      // The 2nd prompt's watchdog fires. Since the session is still busy
      // (no idle event for the 2nd prompt), the watchdog returns early without
      // fabricating. The KEY assertion: the status is still busy — the stale
      // 1st watchdog never fired to clobber it.
      expect(store.getState().session_status?.["session-a"]).toEqual({ type: "busy" })

      // No synthetic error messages were created (watchdog returned early)
      const messages = store.getState().message["session-a"] ?? []
      const syntheticErrors = messages.filter(
        (m) =>
          (m as Message & { metadata?: Record<string, unknown> }).metadata?.source ===
          "desktop-accepted-prompt-watchdog",
      )
      expect(syntheticErrors.length).toBe(0)
    } finally {
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
    }
  })

  test("does not force idle from a previous turn's completed assistant when a newer prompt is in progress", async () => {
    // This test exercises the defense-in-depth guard: even if the stale timer
    // somehow fires (e.g., race between clearTimeout and the event loop), the
    // newerUnanswered check prevents it from forcing idle.
    const originalSetTimeout = globalThis.setTimeout
    const originalClearTimeout = globalThis.clearTimeout
    const timers: Array<{ id: number; callback: () => void; messageID?: string }> = []
    let nextTimerId = 1

    // Don't cancel — let ALL timers fire so we can test the guard
    globalThis.setTimeout = ((callback: () => void) => {
      const id = nextTimerId++
      timers.push({ id, callback })
      return id as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout

    globalThis.clearTimeout = (() => {
      // Intentionally a no-op: we WANT stale timers to fire to test the guard
    }) as unknown as typeof clearTimeout

    try {
      const store = createStore({})
      const { optimisticSend } = await setupOptimistic(store)

      // 1st prompt
      let firstMessageId = ""
      await optimisticSend({
        sessionId: "session-a",
        content: "first prompt",
        providerID: "provider",
        modelID: "model",
        send: (messageID) => {
          firstMessageId = messageID
          return Promise.resolve()
        },
      })

      // Simulate 1st prompt completing
      store.setState((state) => ({
        session_status: { ...state.session_status, "session-a": { type: "idle" as const } },
        message: {
          ...state.message,
          "session-a": [
            ...(state.message["session-a"] ?? []),
            {
              id: "msg_first_assistant",
              role: "assistant",
              sessionID: "session-a",
              parentID: firstMessageId,
              time: { created: 1, completed: 2 },
            } as unknown as Message,
          ],
        },
      }))

      // 2nd prompt — optimistic busy
      await optimisticSend({
        sessionId: "session-a",
        content: "second prompt",
        providerID: "provider",
        modelID: "model",
        send: () => Promise.resolve(),
      })

      // Status is busy (2nd prompt)
      expect(store.getState().session_status?.["session-a"]).toEqual({ type: "busy" })

      // Fire the 1st prompt's watchdog (stale timer). Even though clearTimeout
      // is a no-op in this test, the newerUnanswered guard should prevent
      // it from forcing idle.
      await timers[0].callback()
      await new Promise((resolve) => originalSetTimeout(resolve, 0))

      // Status should STILL be busy — the stale watchdog's newerUnanswered
      // guard caught that the 2nd prompt (newer user message) has no assistant
      // response yet, so it did NOT force idle.
      expect(store.getState().session_status?.["session-a"]).toEqual({ type: "busy" })
    } finally {
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
    }
  })
})

describe("optimisticSend: markPromptAccepted is synchronous with busy-set (race condition fix)", () => {
  // Regression test for the bug where 2nd+ prompts always triggered the watchdog.
  //
  // Root cause: markPromptAccepted was called AFTER await input.send(), so any
  // status poll that fired during the connection-wait or POST round-trip saw
  // promptRecentlyAccepted=false and clobbered the optimistic busy→idle.
  //
  // The fix: markPromptAccepted is called synchronously with store.setState({busy}),
  // before any await. This test verifies the invariant holds for 4 consecutive prompts.

  const setupOptimistic = async (store: ReturnType<typeof createStore>) => {
    const childStores = createChildStores([["/test/project", store]])
    const { setActionRefs, setOptimisticRefs, optimisticSend, wasPromptRecentlyAccepted } = await import(
      "./session-actions"
    )
    setActionRefs(mockSdk as unknown as AxCodeClient, childStores, () => "/test/project")
    setOptimisticRefs(
      ({ sessionID, message, parts }) => {
        store.setState((state) => ({
          message: {
            ...state.message,
            [sessionID]: [...(state.message[sessionID] ?? []), message],
          },
          part: { ...state.part, [message.id]: parts },
        }))
      },
      ({ sessionID, messageID }) => {
        store.setState((state) => {
          const messages = state.message[sessionID] ?? []
          const nextPart = { ...state.part }
          delete nextPart[messageID]
          return {
            message: { ...state.message, [sessionID]: messages.filter((m) => m.id !== messageID) },
            part: nextPart,
          }
        })
      },
    )
    return { optimisticSend, wasPromptRecentlyAccepted }
  }

  test("wasPromptRecentlyAccepted is true during the send for all 4 consecutive prompts", async () => {
    const store = createStore({})
    const { optimisticSend, wasPromptRecentlyAccepted } = await setupOptimistic(store)

    for (let i = 0; i < 4; i++) {
      // Simulate a completed turn: session goes back to idle with a finished assistant reply.
      store.setState((state) => ({
        session_status: { ...state.session_status, "session-a": { type: "idle" as const } },
        message: {
          ...state.message,
          "session-a": [
            {
              id: `prev-assistant-${i}`,
              role: "assistant",
              sessionID: "session-a",
              time: { created: 1, completed: 2 },
            } as unknown as Message,
          ],
        },
      }))

      let acceptedDuringSend = false
      let pollResultDuringSend: ReturnType<typeof resolveResyncedSessionStatus> | undefined

      await optimisticSend({
        sessionId: "session-a",
        content: `prompt ${i + 1}`,
        providerID: "provider",
        modelID: "model",
        send: async () => {
          // This callback fires while awaiting the POST — the exact window the
          // periodic status poll can fire. Verify our invariants hold here.
          acceptedDuringSend = wasPromptRecentlyAccepted("session-a")

          // Simulate the status poll calling resolveResyncedSessionStatus with
          // serverStatus=undefined (ax-code hasn't registered the session yet).
          const state = store.getState()
          pollResultDuringSend = resolveResyncedSessionStatus({
            serverStatus: undefined,
            existingStatus: state.session_status?.["session-a"],
            promptRecentlyAccepted: wasPromptRecentlyAccepted("session-a"),
            hasCompletedAssistantReply: hasCompletedAssistantReply(state.message?.["session-a"]),
          })
        },
      })

      expect(acceptedDuringSend).toBe(true)
      expect(pollResultDuringSend).toEqual({ type: "busy" })
      expect(store.getState().session_status?.["session-a"]).toEqual({ type: "busy" })
    }
  })
})

describe("optimisticSend: watchdog recovery does not clobber a newer prompt (async recovery race fix)", () => {
  // Regression test for the bug where the watchdog's async server-refetch
  // (recoverAcceptedPromptFromServer) completed during a NEWER prompt's turn.
  // The recovery found the OLD prompt's completed assistant response, saw the
  // NEW prompt's busy status, and incorrectly forced idle — clobbering the
  // new turn.
  //
  // Root cause: the recovery branch forced idle based on isSessionWorking()
  // alone, without checking whether a NEWER user message existed without its
  // own assistant reply (the same cross-turn guard the initial-match branch has).

  const setupOptimisticForRecovery = async (store: ReturnType<typeof createStore>) => {
    const childStores = createChildStores([["/test/project", store]])
    const { setActionRefs, setOptimisticRefs, optimisticSend } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as AxCodeClient, childStores, () => "/test/project")
    setOptimisticRefs(
      ({ sessionID, message, parts }) => {
        store.setState((state) => ({
          message: { ...state.message, [sessionID]: [...(state.message[sessionID] ?? []), message] },
          part: { ...state.part, [message.id]: parts },
        }))
      },
      ({ sessionID, messageID }) => {
        store.setState((state) => {
          const messages = state.message[sessionID] ?? []
          const nextPart = { ...state.part }
          delete nextPart[messageID]
          return {
            message: { ...state.message, [sessionID]: messages.filter((m) => m.id !== messageID) },
            part: nextPart,
          }
        })
      },
    )
    return { optimisticSend }
  }

  test("recovery finding an old completed response does not force idle when a newer prompt is in progress", async () => {
    const originalSetTimeout = globalThis.setTimeout
    const originalClearTimeout = globalThis.clearTimeout
    const timers: Array<() => void> = []

    // Fire timers immediately
    globalThis.setTimeout = ((callback: () => void) => {
      timers.push(callback)
      return 0 as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout
    globalThis.clearTimeout = (() => {}) as unknown as typeof clearTimeout

    try {
      const store = createStore({})
      const { optimisticSend } = await setupOptimisticForRecovery(store)

      // 1st prompt — response will be "dropped" (not in store, but on server)
      let firstMessageId = ""
      await optimisticSend({
        sessionId: "session-a",
        content: "first prompt",
        providerID: "provider",
        modelID: "model",
        send: (messageID) => {
          firstMessageId = messageID
          return Promise.resolve()
        },
      })

      // Simulate the 1st prompt's response being dropped: set idle, no assistant
      store.setState((state) => ({
        session_status: { ...state.session_status, "session-a": { type: "idle" as const } },
      }))

      // Configure the mock server to return the 1st prompt's completed response
      resetScopedMessagesResult()
      scopedMessagesResult = {
        data: [
          {
            info: {
              id: firstMessageId,
              sessionID: "session-a",
              role: "user",
              time: { created: 1 },
            } as unknown as Message,
            parts: [],
          },
          {
            info: {
              id: "msg_first_assistant",
              sessionID: "session-a",
              role: "assistant",
              parentID: firstMessageId,
              time: { created: 2, completed: 3 },
            } as unknown as Message,
            parts: [
              { id: "prt_a", type: "text", messageID: "msg_first_assistant", text: "real reply" } as unknown as Part,
            ],
          },
        ],
      }

      // Fire the 1st prompt's watchdog. It will:
      // 1. Not find assistantResponse in store (dropped) → skip initial branch
      // 2. isSessionWorking → false → proceed to recovery
      // 3. recoverAcceptedPromptFromServer → async refetch
      // DURING the await, simulate the 2nd prompt starting:
      const watchdogPromise = timers[0]()
      // While watchdog is awaiting recovery, user sends 2nd prompt
      store.setState((state) => ({
        session_status: { ...state.session_status, "session-a": { type: "busy" as const } },
        message: {
          ...state.message,
          "session-a": [
            ...(state.message["session-a"] ?? []),
            { id: "msg_user_2", role: "user", sessionID: "session-a", time: { created: 10 } } as unknown as Message,
          ],
        },
      }))
      await watchdogPromise
      await new Promise((resolve) => originalSetTimeout(resolve, 0))

      // The recovery found the 1st prompt's response, but the 2nd prompt is now
      // in progress (busy, no assistant reply for msg_user_2). The watchdog
      // must NOT have forced idle.
      expect(store.getState().session_status?.["session-a"]).toEqual({ type: "busy" })
    } finally {
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
    }
  })
})

describe("optimisticSend: grace-window re-arm prevents false error on same-turn SSE idle clobber", () => {
  // Regression test for the v1.2.7 bug where the watchdog fabricated a
  // synthetic error when an SSE session.idle / session.status:idle event
  // transiently clobbered busy→idle during the 30s prompt-accepted grace
  // window.
  //
  // Root cause: the grace window (wasPromptRecentlyAccepted) only guards the
  // status-poll path (resolveResyncedSessionStatus), NOT the event-reducer's
  // direct status writes. An SSE idle event clobbers busy→idle; the 12s
  // watchdog then sees idle + no response + server-recovery-finds-nothing and
  // fabricates a false error.
  //
  // Fix: the watchdog's fabrication branch re-arms itself until the grace
  // window expires, so a transient grace-window clobber does NOT fabricate.

  const setupOptimistic = async (store: ReturnType<typeof createStore>) => {
    const childStores = createChildStores([["/test/project", store]])
    const { setActionRefs, setOptimisticRefs, optimisticSend } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as AxCodeClient, childStores, () => "/test/project")
    setOptimisticRefs(
      ({ sessionID, message, parts }) => {
        store.setState((state) => ({
          message: {
            ...state.message,
            [sessionID]: [...(state.message[sessionID] ?? []), message],
          },
          part: { ...state.part, [message.id]: parts },
        }))
      },
      ({ sessionID, messageID }) => {
        store.setState((state) => {
          const messages = state.message[sessionID] ?? []
          const nextPart = { ...state.part }
          delete nextPart[messageID]
          return {
            message: { ...state.message, [sessionID]: messages.filter((m) => m.id !== messageID) },
            part: nextPart,
          }
        })
      },
    )
    return { optimisticSend }
  }

  test("does not fabricate a synthetic error when SSE idle clobbers busy during the grace window", async () => {
    const originalSetTimeout = globalThis.setTimeout
    const originalClearTimeout = globalThis.clearTimeout
    const timers: Array<() => void> = []

    // Capture timers so we can fire them on demand. clearTimeout is a no-op so
    // re-arm timers survive (we want to observe both the initial fire and the
    // re-arm path).
    globalThis.setTimeout = ((callback: () => void) => {
      timers.push(callback)
      return 0 as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout
    globalThis.clearTimeout = (() => {}) as unknown as typeof clearTimeout

    try {
      const store = createStore({})
      const { optimisticSend } = await setupOptimistic(store)
      resetScopedMessagesResult()
      // Server also has nothing — the fabrication branch is reachable.
      scopedMessagesResult = { data: [] }

      await optimisticSend({
        sessionId: "session-a",
        content: "prompt that will be clobbered by SSE idle",
        providerID: "provider",
        modelID: "model",
        send: () => Promise.resolve(),
      })

      // Simulate an SSE session.idle event clobbering busy→idle DURING the
      // grace window (the event-reducer writes idle directly, bypassing the
      // poll-path grace guard).
      store.setState((state) => ({
        session_status: {
          ...state.session_status,
          "session-a": { type: "idle" as const },
        },
      }))

      // Fire the watchdog (t=12s). Without the fix this would fabricate the
      // synthetic error because status=idle, no assistant response, server has
      // nothing — even though the prompt is still within the 30s grace window.
      await timers[0]()
      await new Promise((resolve) => originalSetTimeout(resolve, 0))

      // With the fix: no synthetic error fabricated — the watchdog re-armed
      // itself instead. Status remains idle (as clobbered), but NO error
      // message was added.
      const messages = store.getState().message["session-a"] ?? []
      const syntheticErrors = messages.filter(
        (m) =>
          (m as Message & { metadata?: Record<string, unknown> }).metadata?.source ===
          "desktop-accepted-prompt-watchdog",
      )
      expect(syntheticErrors.length).toBe(0)

      // The watchdog should have scheduled a re-arm timer (timers.length grew).
      expect(timers.length).toBeGreaterThan(1)
    } finally {
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
    }
  })
})
