import { describe, expect, test, vi } from "vitest"
import { WorkMode } from "../../../src/mode/work-mode"
import {
  createPromptSubmitController,
  type PromptSubmitHost,
} from "../../../src/cli/cmd/tui/component/prompt/prompt-submit-controller"

function setup(input: { mode: "normal" | "shell"; workMode: WorkMode.Id; text: string }) {
  const requests: Request[] = []
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
    sync: { data: { command: [{ name: "council" }, { name: "arena" }] } },
    sdk: {
      url: "http://localhost:4096",
      directory: "/test/workspace",
      fetch: async (url: string, init: RequestInit) => {
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
    setSubmitPending: vi.fn(),
    submitPending: () => false,
    setSubmitStage: vi.fn(),
    draftSessionID: () => undefined,
    setDraftSessionID: vi.fn(),
    syncInputCursorColor: vi.fn(),
  }
  return { controller: createPromptSubmitController(host), host, requests, model }
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
