import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest"
import type { Session } from "@ax-code/sdk/v2"
import { WorkMode } from "../../../src/mode/work-mode"
import {
  createPromptSubmitController,
  type PromptSubmitHost,
} from "../../../src/cli/tui/component/prompt/prompt-submit-controller"

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

function setup(input: {
  mode: "normal" | "shell"
  workMode: WorkMode.Id
  text: string
  providers?: unknown[]
  providerLoaded?: boolean
  config?: {
    modes?: {
      council?: { enabled?: boolean; maxMembers?: number }
      arena?: { enabled?: boolean; maxContestants?: number }
    }
  }
}) {
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
    kv: {
      get: (key: string, fallback?: unknown) => (key === "work_mode" ? input.workMode : fallback),
      set: vi.fn(),
    },
    command: { trySlash: vi.fn(() => false) },
    sync: {
      data: {
        command: [{ name: "council" }, { name: "arena" }],
        provider: input.providers ?? [
          { id: "p1", models: { m: { tool_call: true } } },
          { id: "p2", models: { m: { tool_call: true } } },
        ],
        provider_loaded: input.providerLoaded ?? true,
        provider_failed: false,
        task_queue: [],
        config: input.config ?? { modes: { arena: { enabled: true } } },
      },
      set: vi.fn(),
    },
    sdk: {
      url: "http://localhost:4096",
      directory: "/test/workspace",
      baseDirectory: "/test/workspace",
      sseConnected: true,
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

test("busy follow-ups retain the draft until durable acknowledgement and reuse identity after a lost response", async () => {
  const { controller, host } = setup({ mode: "normal", workMode: "agent", text: "Review the patch" })
  host.queueModeEnabled = () => true
  host.status = () => ({ type: "busy" })
  const attempts: Request[] = []
  host.sdk.fetch = async (url, init) => {
    attempts.push(new Request(url, init))
    if (attempts.length === 1) throw new Error("Connection lost after acceptance")
    return Response.json({ id: "queue_saved", status: "waiting_for_idle" }, { status: 202 })
  }
  await controller.submit()
  expect(host.input.clear).not.toHaveBeenCalled()
  // A retry stays a follow-up even if the first accepted attempt has already finished.
  host.status = () => ({ type: "idle" })
  await controller.submit()
  expect(host.input.clear).toHaveBeenCalledTimes(1)
  expect(attempts).toHaveLength(2)
  const first = await attempts[0].json()
  const second = await attempts[1].json()
  expect(second.messageID).toBe(first.messageID)
  expect(new URL(attempts[0].url).searchParams.get("followup")).toBe("true")
  expect(new URL(attempts[1].url).searchParams.get("followup")).toBe("true")
})

test.each([15_300, 45_150])(
  "session creation waits %d ms through SQLite contention without a premature failure",
  async (delay) => {
    vi.useFakeTimers()
    const { controller, host, create, requests } = setupNewSession()
    create.mockImplementation(
      ({ id }) => new Promise((resolve) => setTimeout(() => resolve({ data: session(id) }), delay)),
    )
    const submitted = controller.submit()
    await vi.advanceTimersByTimeAsync(delay)
    await submitted
    expect(host.toast.show).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledTimes(1)
    expect(requests).toHaveLength(1)
  },
)

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
  test.each([
    {
      name: "blocks a council submit with fewer than two providers and preserves the draft",
      workMode: "council" as const,
      providers: [{ id: "p1", models: { m: { tool_call: true } } }],
    },
    {
      name: "blocks an arena submit while arena is disabled",
      workMode: "arena" as const,
      config: { modes: {} } as { modes?: { arena?: { enabled?: boolean } } },
    },
    {
      name: "blocks while providers are still loading",
      workMode: "council" as const,
      providerLoaded: false,
    },
  ])("$name", async (scenario) => {
    const { controller, host, requests } = setup({
      mode: "normal",
      workMode: scenario.workMode,
      text: "Review this change",
      providers: scenario.providers,
      providerLoaded: scenario.providerLoaded,
      config: scenario.config,
    })

    await controller.submit()

    expect(requests).toHaveLength(0)
    expect(host.history.append).not.toHaveBeenCalled()
    expect(host.clearPromptDraft).not.toHaveBeenCalled()
    expect(host.toast.show).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }))
    expect(host.kv.set).not.toHaveBeenCalled()
    expect(controller.submitInFlight).toBe(false)
  })

  test("still dispatches local slash commands when council is unavailable", async () => {
    const { controller, host, requests } = setup({
      mode: "normal",
      workMode: "council",
      text: "/model",
      providers: [{ id: "p1", models: { m: { tool_call: true } } }],
    })
    host.command.trySlash = vi.fn(() => true)

    await controller.submit()

    expect(host.command.trySlash).toHaveBeenCalledWith("model")
    expect(host.clearPromptDraft).toHaveBeenCalled()
    expect(requests).toHaveLength(0)
    expect(host.toast.show).not.toHaveBeenCalled()
  })

  test("records first-use after a successful council submit", async () => {
    const { controller, host } = setup({ mode: "normal", workMode: "council", text: "Review this change" })
    await controller.submit()
    expect(host.kv.set).toHaveBeenCalledWith("work_mode_hint_seen", expect.objectContaining({ council: true }))
  })

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

describe("prompt editor disposal during navigation", () => {
  test("ignores late session creation after its editor is disposed", async () => {
    const { controller, host, create, requests } = setupNewSession()
    let finish!: (result: { data: Session }) => void
    create.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = controller.submit()
    controller.dispose()
    finish({ data: session("ses_late_creation") })
    await pending
    expect(requests).toHaveLength(0)
    expect(host.onSubmit).not.toHaveBeenCalled()
    expect(host.history.append).not.toHaveBeenCalled()
    expect(host.route.navigate).not.toHaveBeenCalled()
    expect(host.input.clear).not.toHaveBeenCalled()
  })

  test("does not settle or clear a draft after disposed editor dispatch resolves late", async () => {
    const { controller, host } = setup({ mode: "normal", workMode: "agent", text: "Session A draft" })
    let finish!: (response: Response) => void
    host.sdk.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    )
    const pending = controller.submit()
    expect(host.sdk.fetch).toHaveBeenCalledOnce()
    controller.dispose()
    finish(new Response(null, { status: 202 }))
    await pending
    expect(host.onSubmit).not.toHaveBeenCalled()
    expect(host.history.append).not.toHaveBeenCalled()
    expect(host.input.clear).not.toHaveBeenCalled()
    expect(host.route.navigate).not.toHaveBeenCalled()
  })
})

describe("TUI conversation language payload", () => {
  test.each(["zh-TW", "zh-CN", "ja", "ko"] as const)(
    "%s preference keeps prompt and command arguments verbatim",
    async (locale) => {
      const { conversationInstruction } = await import("../../../src/cli/tui/i18n")
      for (const workMode of ["agent", "council", "arena"] as const) {
        const text =
          "Review authentication; do not edit. \u4e0d\u8981\u4fee\u6539\u6a94\u6848. Keep `file.ts` and $HOME verbatim."
        const fixture = setup({ mode: "normal", workMode, text })
        fixture.host.conversationSystem = () => conversationInstruction(locale)
        await fixture.controller.submit()
        expect(fixture.requests).toHaveLength(1)
        const body = await fixture.requests[0].json()
        expect(body.system).toBe(conversationInstruction(locale))
        if (workMode === "agent") expect(body.parts[0].text).toBe(text)
        else {
          const routed = WorkMode.routeInput(workMode, text)
          expect(routed.kind).toBe("command")
          if (routed.kind === "command") expect(body.arguments).toBe(routed.arguments)
        }
      }
    },
  )
  test("shell commands receive no conversation instruction", async () => {
    const fixture = setup({ mode: "shell", workMode: "agent", text: "echo $HOME" })
    fixture.host.conversationSystem = () => "Reply in Japanese."
    await fixture.controller.submit()
    const body = await fixture.requests[0].json()
    expect(body.command).toBe("echo $HOME")
    expect(body.system).toBeUndefined()
  })
})

describe("send-now steering", () => {
  function steerSetup(input: { generation: string | null; receipt?: { status: string; reason?: string } }) {
    const fixture = setup({ mode: "normal", workMode: "agent", text: "use the other config file" })
    fixture.host.queueModeEnabled = () => true
    fixture.host.status = () => ({ type: "busy" })
    const steering = vi.fn(async () => ({ data: { generation: input.generation } }))
    const steer = vi.fn(async () => ({ data: input.receipt ?? { status: "accepted" } }))
    fixture.host.sdk.client = {
      session: { create: vi.fn(async ({ id }: { id: string }) => ({ data: session(id) })), steering, steer },
    } as any
    return { ...fixture, steering, steer }
  }

  test("the steer gesture delivers text into the running turn and clears the draft", async () => {
    const { controller, host, requests, steering, steer } = steerSetup({ generation: "gen-1" })
    await controller.submitSteer()
    expect(steering).toHaveBeenCalledWith({ sessionID: "ses_test" }, { signal: expect.any(AbortSignal) })
    expect(steer).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "ses_test",
        expectedGeneration: "gen-1",
        text: "use the other config file",
      }),
      { signal: expect.any(AbortSignal) },
    )
    // No follow-up was queued: nothing hit the async prompt route.
    expect(requests).toHaveLength(0)
    expect(host.input.clear).toHaveBeenCalledTimes(1)
    expect(host.toast.show).toHaveBeenCalledWith(expect.objectContaining({ variant: "info" }))
  })

  test("without an active generation the steer gesture falls back to the follow-up queue", async () => {
    const { controller, host, requests, steer } = steerSetup({ generation: null })
    host.sdk.fetch = async (url, init) => {
      requests.push(new Request(url, init))
      return Response.json({ id: "queue_saved", status: "waiting_for_idle" }, { status: 202 })
    }
    await controller.submitSteer()
    expect(steer).not.toHaveBeenCalled()
    expect(requests).toHaveLength(1)
    expect(new URL(requests[0].url).searchParams.get("followup")).toBe("true")
    expect(host.input.clear).toHaveBeenCalledTimes(1)
  })

  test("a vetoed steer keeps the draft and reports the reason", async () => {
    const { controller, host, requests } = steerSetup({
      generation: "gen-1",
      receipt: { status: "rejected", reason: "admission_rejected" },
    })
    await controller.submitSteer()
    expect(requests).toHaveLength(0)
    expect(host.input.clear).not.toHaveBeenCalled()
    expect(host.toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: "Steering failed: admission_rejected" }),
    )
    expect(host.submitPending()).toBe(false)
  })

  test("the plain submit path never steers", async () => {
    const { controller, host, requests, steering } = steerSetup({ generation: "gen-1" })
    host.sdk.fetch = async (url, init) => {
      requests.push(new Request(url, init))
      return Response.json({ id: "queue_saved", status: "waiting_for_idle" }, { status: 202 })
    }
    await controller.submit()
    expect(steering).not.toHaveBeenCalled()
    expect(requests).toHaveLength(1)
  })

  test.each(["cancel", "dispose"] as const)("%s prevents steering after a late generation lookup", async (action) => {
    const { controller, host, requests, steering, steer } = steerSetup({ generation: "gen-1" })
    const lookup = Promise.withResolvers<{ data: { generation: string } }>()
    steering.mockImplementation(() => lookup.promise)
    const pending = controller.submitSteer()
    expect(steering).toHaveBeenCalledOnce()

    if (action === "cancel") expect(controller.cancelPendingSubmit()).toBe(true)
    else controller.dispose()
    lookup.resolve({ data: { generation: "gen-1" } })
    await pending

    expect(steer).not.toHaveBeenCalled()
    expect(requests).toHaveLength(0)
    expect(host.input.clear).not.toHaveBeenCalled()
    expect(host.history.append).not.toHaveBeenCalled()
  })

  test("cancelling an in-flight steering request aborts its transport and keeps the draft", async () => {
    const { controller, host, steering, requests } = steerSetup({ generation: "gen-1" })
    const receipt = Promise.withResolvers<{ data: { status: "accepted" } }>()
    let signal: AbortSignal | undefined
    host.sdk.client.session.steer = async (_parameters, options) => {
      signal = options?.signal
      return receipt.promise
    }
    const pending = controller.submitSteer()
    await vi.waitFor(() => expect(signal).toBeInstanceOf(AbortSignal))
    expect(steering).toHaveBeenCalledWith({ sessionID: "ses_test" }, { signal })

    expect(controller.cancelPendingSubmit()).toBe(true)
    expect(signal?.aborted).toBe(true)
    receipt.resolve({ data: { status: "accepted" } })
    await pending

    expect(requests).toHaveLength(0)
    expect(host.input.clear).not.toHaveBeenCalled()
    expect(host.history.append).not.toHaveBeenCalled()
    expect(host.submitPending()).toBe(false)
    expect(controller.submitInFlight).toBe(false)
  })
})

describe("empty-composer queue promotion", () => {
  function followUpRow(input: { id: string; text: string; position: number; status?: string; sessionID?: string }) {
    return {
      id: input.id,
      sessionID: input.sessionID ?? "ses_test",
      kind: "followup",
      status: input.status ?? "waiting_for_idle",
      title: input.text.slice(0, 40),
      position: input.position,
      time: { created: input.position + 1 },
      payload: {
        body: {
          parts: [{ type: "text", text: input.text }],
          agent: "build",
          model: { providerID: "test-provider", modelID: "test-model" },
        },
      },
    }
  }

  function promotionSetup(rows: unknown[]) {
    const fixture = setup({ mode: "normal", workMode: "agent", text: "" })
    fixture.host.queueModeEnabled = () => true
    fixture.host.status = () => ({ type: "busy" })
    fixture.host.sync.data.task_queue = rows
    return fixture
  }

  function cancelledCopy(row: any) {
    return { ...row, status: "cancelled", payload: { ...row.payload, steeredInto: "gen-1", steeredAt: 1000 } }
  }

  test("steers the steerable prefix of the saved queue in FIFO order", async () => {
    const first = followUpRow({ id: "tas_1", text: "first queued", position: 0 })
    const second = followUpRow({ id: "tas_2", text: "second queued", position: 1 })
    const otherSession = followUpRow({ id: "tas_9", text: "not this session", position: 2, sessionID: "ses_other" })
    const { controller, host, requests } = promotionSetup([first, second, otherSession])
    host.sdk.fetch = async (url, init) => {
      requests.push(new Request(url, init))
      const id = String(url).split("/task-queue/")[1]!.split("/")[0]
      const source = [first, second].find((row) => row.id === id)!
      return Response.json({ item: cancelledCopy(source), receipt: { status: "accepted" } })
    }
    await controller.submitSteer()
    expect(requests.map((request) => request.url)).toEqual([
      "http://localhost:4096/task-queue/tas_1/steer",
      "http://localhost:4096/task-queue/tas_2/steer",
    ])
    expect(host.toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "info", message: "Steered 2 follow-up(s) into the running turn" }),
    )
    expect(host.input.clear).not.toHaveBeenCalled()
  })

  test("an empty queue reports nothing to steer and sends no requests", async () => {
    const { controller, host, requests } = promotionSetup([])
    await controller.submitSteer()
    expect(requests).toHaveLength(0)
    expect(host.toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "info", message: "No saved follow-ups to steer" }),
    )
  })

  test("a leading barrier steers nothing and keeps every row queued", async () => {
    const paused = followUpRow({ id: "tas_1", text: "parked", position: 0, status: "paused" })
    const steerable = followUpRow({ id: "tas_2", text: "waiting behind", position: 1 })
    const { controller, host, requests } = promotionSetup([paused, steerable])
    await controller.submitSteer()
    expect(requests).toHaveLength(0)
    expect(host.toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "info", message: "Nothing in the queue can steer the running turn" }),
    )
  })

  test("without an active generation only the first miss is prioritized", async () => {
    const first = followUpRow({ id: "tas_1", text: "first queued", position: 0 })
    const second = followUpRow({ id: "tas_2", text: "second queued", position: 1 })
    const { controller, host, requests } = promotionSetup([first, second])
    host.sdk.fetch = async (url, init) => {
      requests.push(new Request(url, init))
      if (String(url).endsWith("/steer"))
        return Response.json({ item: first, receipt: null, reason: "generation_not_active" })
      return Response.json({ ...first, status: "queued", position: 0 })
    }
    await controller.submitSteer()
    expect(requests.map((request) => request.url)).toEqual([
      "http://localhost:4096/task-queue/tas_1/steer",
      "http://localhost:4096/task-queue/tas_1/send-now",
    ])
    expect(host.toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "info", message: "No running turn; moved to the front of the queue" }),
    )
  })

  test("a failed steer stops the promotion and keeps later rows queued", async () => {
    const first = followUpRow({ id: "tas_1", text: "first queued", position: 0 })
    const second = followUpRow({ id: "tas_2", text: "second queued", position: 1 })
    const { controller, host, requests } = promotionSetup([first, second])
    host.sdk.fetch = async (url, init) => {
      requests.push(new Request(url, init))
      return Response.json({ message: "row changed" }, { status: 409 })
    }
    await controller.submitSteer()
    expect(requests).toHaveLength(1)
    expect(host.toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: "Steering failed: row changed" }),
    )
  })

  test("an idle session with an empty composer stays a no-op", async () => {
    const fixture = setup({ mode: "normal", workMode: "agent", text: "" })
    fixture.host.queueModeEnabled = () => true
    fixture.host.status = () => ({ type: "idle" })
    fixture.host.sync.data.task_queue = [followUpRow({ id: "tas_1", text: "queued", position: 0 })]
    await fixture.controller.submitSteer()
    expect(fixture.requests).toHaveLength(0)
    expect(fixture.host.toast.show).not.toHaveBeenCalled()
  })
})
