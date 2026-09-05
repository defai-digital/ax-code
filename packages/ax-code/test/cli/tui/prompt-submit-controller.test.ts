import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest"
import type { Session } from "@ax-code/sdk/v2"
import { WorkMode } from "../../../src/mode/work-mode"
import {
  createPromptSubmitController,
  type PromptSubmitHost,
} from "../../../src/cli/cmd/tui/component/prompt/prompt-submit-controller"

afterEach(() => vi.useRealTimers())

function session(id: string): Session {
  return {
    id,
    slug: "submit-fixture",
    projectID: "project-fixture",
    directory: "/test/workspace",
    title: "Prompt submission fixture",
    version: "1.0.0",
    time: { created: 1, updated: 1 },
  }
}

function setup(input: { mode: "normal" | "shell"; workMode: WorkMode.Id; text: string }) {
  const requests: Request[] = []
  let pending = false
  let draftSessionID: string | undefined
  const model = { providerID: "test-provider", modelID: "test-model" }
  const host: PromptSubmitHost = {
    input: { extmarks: { getAllForTypeId: () => [], clear: vi.fn() }, clear: vi.fn() },
    store: { prompt: { input: input.text, parts: [] }, mode: input.mode, extmarkToPartIndex: new Map() },
    setStore: vi.fn(),
    setExpandedPastes: vi.fn(),
    promptPartTypeId: () => 1,
    inputBlocked: () => false,
    syncPromptInputFromRenderable: () => input.text,
    promptModelWarning: vi.fn(),
    clearPromptDraft: vi.fn(),
    onSubmit: vi.fn(),
    exit: vi.fn(),
    sessionID: () => "ses_test",
    workspaceID: () => undefined,
    autocomplete: { visible: false },
    local: {
      model: { current: () => model, variant: { current: () => undefined } },
      agent: { current: () => ({ name: "build" }) },
    },
    kv: { get: () => input.workMode },
    command: { trySlash: vi.fn(() => false) },
    sync: {
      data: {
        command: [{ name: "council" }, { name: "arena" }],
        provider: [],
        provider_loaded: true,
        provider_failed: false,
      },
      set: vi.fn(),
    },
    sdk: {
      url: "http://localhost:4096",
      directory: "/test/workspace",
      baseDirectory: "/test/workspace",
      client: { session: { create: vi.fn(async ({ id }) => ({ data: session(id) })) } },
      fetch: async (url, init) => {
        requests.push(new Request(url, init))
        return new Response(null, { status: 202 })
      },
    },
    route: { navigate: vi.fn() },
    history: { append: vi.fn() },
    toast: { show: vi.fn() },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    status: () => ({ type: "idle" }),
    queueModeEnabled: () => false,
    axEngineDownloadJob: () => undefined,
    setSubmitPending: vi.fn((value) => {
      pending = value
    }),
    submitPending: () => pending,
    setSubmitStage: vi.fn(),
    draftSessionID: () => draftSessionID,
    setDraftSessionID: vi.fn((value) => {
      draftSessionID = value
    }),
    syncInputCursorColor: vi.fn(),
  }
  return { controller: createPromptSubmitController(host), host, requests, model }
}

function setupNewSession() {
  const fixture = setup({ mode: "normal", workMode: "agent", text: "Review the change" })
  const create = vi.fn(async ({ id }: { id: string }) => ({ data: session(id) }))
  fixture.host.sessionID = () => undefined
  fixture.host.sdk.client = { session: { create } }
  fixture.host.sync.set = vi.fn()
  return { ...fixture, create }
}

describe.each(WorkMode.ALL)("prompt submission in %s work mode", (workMode) => {
  test.each(["git status", "  printf 'first\\nsecond\\n' | head -n 1\n  pwd  ", "  /usr/bin/printf '%s' hello  "])(
    "submits shell input unchanged: %s",
    async (text) => {
      const { controller, host, requests, model } = setup({ mode: "shell", workMode, text })

      await controller.submit()

      expect(requests).toHaveLength(1)
      expect(new URL(requests[0].url).pathname).toBe("/session/ses_test/shell_async")
      expect(await requests[0].json()).toEqual({ agent: "build", model, command: text })
      expect(host.command.trySlash).not.toHaveBeenCalled()
      expect(host.history.append).toHaveBeenCalledWith({ input: text, parts: [], mode: "shell" })
      expect(host.setStore).toHaveBeenCalledWith("mode", "normal")
      expect(host.toast.show).not.toHaveBeenCalled()
      expect(controller.submitInFlight).toBe(false)
    },
  )

  test("routes normal prompts according to the selected work mode", async () => {
    const { controller, requests } = setup({ mode: "normal", workMode, text: "Review this change" })

    await controller.submit()

    expect(requests).toHaveLength(1)
    const body = await requests[0].json()
    if (workMode === "agent") {
      expect(new URL(requests[0].url).pathname).toBe("/session/ses_test/prompt_async")
      expect(body.parts).toEqual([{ id: expect.any(String), type: "text", text: "Review this change" }])
    } else {
      expect(new URL(requests[0].url).pathname).toBe("/session/ses_test/command_async")
      expect(body).toMatchObject({ command: workMode, arguments: "Review this change" })
    }
  })
})

describe("prompt submission lifecycle", () => {
  test("keeps the controller's integration boundaries typed", () => {
    expectTypeOf<PromptSubmitHost["input"]>().not.toBeAny()
    expectTypeOf<PromptSubmitHost["local"]>().not.toBeAny()
    expectTypeOf<PromptSubmitHost["sync"]>().not.toBeAny()
    expectTypeOf<PromptSubmitHost["sdk"]>().not.toBeAny()
    expectTypeOf<ReturnType<PromptSubmitHost["axEngineDownloadJob"]>>().not.toBeAny()
  })

  test("preserves complete session metadata when inserting a created session", async () => {
    vi.useFakeTimers()
    const { controller, host, create } = setupNewSession()
    let sessions: Session[] = []
    host.sync.set = (key, update) => {
      expect(key).toBe("session")
      sessions = update(sessions)
    }

    await controller.submit()
    await vi.runAllTimersAsync()

    expect(sessions).toEqual([session(create.mock.calls[0][0].id)])
  })

  test("does not submit again while navigation to a new session is pending", async () => {
    vi.useFakeTimers()
    const { controller, host, create, requests } = setupNewSession()

    await controller.submit()
    await controller.submit()

    expect(create).toHaveBeenCalledOnce()
    expect(requests).toHaveLength(1)
    expect(host.history.append).toHaveBeenCalledOnce()
    await vi.runAllTimersAsync()
    expect(host.route.navigate).toHaveBeenCalledOnce()
  })

  test("keeps the new session pinned until the deferred navigation", async () => {
    vi.useFakeTimers()
    const { controller, host, create } = setupNewSession()

    await controller.submit()

    const sessionID = create.mock.calls[0][0].id
    expect(host.draftSessionID()).toBe(sessionID)
    await vi.runAllTimersAsync()
    expect(host.route.navigate).toHaveBeenCalledWith({ type: "session", sessionID })
    expect(host.draftSessionID()).toBeUndefined()
  })

  test("shows the session creation stage while the server is pending", async () => {
    const { controller, host, create } = setupNewSession()
    let finish!: (result: { data: Session }) => void
    create.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    const pending = controller.submit()
    try {
      expect(host.submitPending()).toBe(true)
      expect(host.setSubmitStage).toHaveBeenCalledWith("creating-session")
    } finally {
      controller.cancelPendingSubmit()
      finish({ data: session("ses_cancelled") })
      await pending
    }
  })

  test("ignores a late session creation failure after the user cancels", async () => {
    const { controller, host, create } = setupNewSession()
    let fail!: (error: Error) => void
    create.mockImplementation(() => new Promise((_resolve, reject) => (fail = reject)))
    const pending = controller.submit()

    expect(controller.cancelPendingSubmit()).toBe(true)
    fail(new Error("The cancelled request failed later"))
    await pending

    expect(host.toast.show).toHaveBeenCalledTimes(1)
    expect(host.toast.show).toHaveBeenCalledWith(expect.objectContaining({ variant: "info" }))
    expect(host.history.append).not.toHaveBeenCalled()
    expect(host.route.navigate).not.toHaveBeenCalled()
  })

  test("reuses a created session when dispatch fails and the user retries", async () => {
    vi.useFakeTimers()
    const { controller, host, create, requests } = setupNewSession()
    const fetch = host.sdk.fetch
    host.sdk.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockImplementation(fetch)

    await controller.submit()
    expect(host.submitPending()).toBe(false)
    await controller.submit()
    await vi.runAllTimersAsync()

    expect(create).toHaveBeenCalledOnce()
    const sessionID = create.mock.calls[0][0].id
    expect(new URL(requests[0].url).pathname).toBe(`/session/${sessionID}/prompt_async`)
    expect(host.route.navigate).toHaveBeenCalledWith({ type: "session", sessionID })
  })
})
