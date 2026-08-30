import { describe, expect, test, vi } from "vitest"
import type { AxCodeClient, PermissionRequest, QuestionRequest } from "@ax-code/sdk/v2/client"
import { bootstrapDirectory } from "./bootstrap"
import { INITIAL_STATE, type State } from "./types"

function makeHarness(overrides: Partial<State> = {}) {
  let state: State = { ...INITIAL_STATE, ...overrides }
  const getState = () => state
  const set = (patch: Partial<State>) => {
    state = { ...state, ...patch }
  }
  return { getState, set }
}

const flush = async () => {
  // Phase 2 of bootstrapDirectory is intentionally fire-and-forget
  // (`void Promise.allSettled(...)`), so give its microtasks a couple of
  // real turns of the event loop to settle before asserting on state.
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function makeBaseSdk(overrides: Record<string, unknown> = {}): AxCodeClient {
  return {
    path: {
      get: vi.fn(async () => ({ data: { state: "", config: "", worktree: "/repo", directory: "/repo", home: "" } })),
    },
    session: { status: vi.fn(async () => ({ data: {} })) },
    lsp: { status: vi.fn(async () => ({ data: [] })) },
    vcs: { get: vi.fn(async () => ({ data: undefined })) },
    question: { list: vi.fn(async () => ({ data: [] as QuestionRequest[] })) },
    permission: { list: vi.fn(async () => ({ data: [] as PermissionRequest[] })) },
    ...overrides,
  } as unknown as AxCodeClient
}

describe("bootstrapDirectory — deferred permission/question resync", () => {
  test("a permission list snapshot fetched concurrently with a live update does not clobber the live update", async () => {
    const perm1 = { id: "perm_1", sessionID: "ses_a", permission: "bash" } as PermissionRequest
    const perm2 = { id: "perm_2", sessionID: "ses_a", permission: "write" } as PermissionRequest

    const { getState, set } = makeHarness({ permission: { ses_a: [perm1] } })

    // Simulate the server computing the snapshot response BEFORE perm_2 was
    // created, while the client's live event handler adds perm_2 to the store
    // while the HTTP request for the snapshot is still in flight — a realistic
    // race during a reconnect resync.
    const permissionList = vi.fn(async () => {
      set({ permission: { ...getState().permission, ses_a: [perm1, perm2] } })
      return { data: [perm1] }
    })

    const sdk = makeBaseSdk({ permission: { list: permissionList } })

    await bootstrapDirectory({
      directory: "/repo",
      sdk,
      getState,
      set,
      global: { projects: [{ id: "proj_1", worktree: "/repo" } as never] },
      loadSessions: () => undefined,
    })
    await flush()

    expect(permissionList).toHaveBeenCalledTimes(1)
    // The concurrently-arrived perm_2 must survive: the stale snapshot (which
    // only knew about perm_1) must not overwrite the live state.
    expect(
      getState()
        .permission.ses_a?.map((p) => p.id)
        .sort(),
    ).toEqual(["perm_1", "perm_2"])
  })

  test("a question list snapshot fetched concurrently with a live update does not clobber the live update", async () => {
    const que1 = { id: "que_1", sessionID: "ses_a", questions: [] } as unknown as QuestionRequest
    const que2 = { id: "que_2", sessionID: "ses_a", questions: [] } as unknown as QuestionRequest

    const { getState, set } = makeHarness({ question: { ses_a: [que1] } })

    const questionList = vi.fn(async () => {
      set({ question: { ...getState().question, ses_a: [que1, que2] } })
      return { data: [que1] }
    })

    const sdk = makeBaseSdk({ question: { list: questionList } })

    await bootstrapDirectory({
      directory: "/repo",
      sdk,
      getState,
      set,
      global: { projects: [{ id: "proj_1", worktree: "/repo" } as never] },
      loadSessions: () => undefined,
    })
    await flush()

    expect(questionList).toHaveBeenCalledTimes(1)
    expect(
      getState()
        .question.ses_a?.map((q) => q.id)
        .sort(),
    ).toEqual(["que_1", "que_2"])
  })

  test("still applies an uncontested permission snapshot normally", async () => {
    const perm1 = { id: "perm_1", sessionID: "ses_a", permission: "bash" } as PermissionRequest
    const { getState, set } = makeHarness()

    const sdk = makeBaseSdk({
      permission: { list: vi.fn(async () => ({ data: [perm1] })) },
    })

    await bootstrapDirectory({
      directory: "/repo",
      sdk,
      getState,
      set,
      global: { projects: [{ id: "proj_1", worktree: "/repo" } as never] },
      loadSessions: () => undefined,
    })
    await flush()

    expect(getState().permission.ses_a?.map((p) => p.id)).toEqual(["perm_1"])
  })
})
