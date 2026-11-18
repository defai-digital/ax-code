import { createRoot } from "solid-js"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { Message, Part, UserMessage } from "@ax-code/sdk/v2"
import type { DialogSelectProps } from "../../../src/cli/tui/ui/dialog-select"
import type { DialogContext } from "../../../src/cli/tui/ui/dialog"
import type { Route } from "../../../src/cli/tui/context/route"
import { DialogForkFromTimeline } from "../../../src/cli/tui/routes/session/dialog-fork-from-timeline"
import { DialogMessage } from "../../../src/cli/tui/routes/session/dialog-message"
import { DialogTimeline } from "../../../src/cli/tui/routes/session/dialog-timeline"
import { timelineEntries } from "../../../src/cli/tui/routes/session/timeline-messages"

vi.mock("solid-js", async () => {
  const { createRequire } = await import("node:module")
  return createRequire(import.meta.url)("solid-js/dist/solid.cjs") as typeof import("solid-js")
})

const mocked = vi.hoisted(() => ({
  directory: "/project",
  route: { type: "session", sessionID: "ses_one" } as Route,
  messages: {} as Record<string, Message[]>,
  parts: {} as Record<string, Part[]>,
  view: undefined as DialogSelectProps<string> | undefined,
  fork: vi.fn<
    (input: { sessionID: string; messageID: string }) => Promise<{ data?: { id: string }; error?: unknown }>
  >(),
  move: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
  clear: vi.fn(),
  replace: vi.fn(),
  stack: [] as object[],
}))
vi.mock("@tui/context/language", () => ({ useLanguage: () => ({ t: (key: string) => key }) }))
vi.mock("@tui/context/sync", () => ({
  useSync: () => ({
    data: {
      get message() {
        return mocked.messages
      },
      get part() {
        return mocked.parts
      },
      agent: [],
    },
  }),
}))
vi.mock("@tui/context/sdk", () => ({
  useSDK: () => ({
    get directory() {
      return mocked.directory
    },
    client: { session: { fork: mocked.fork } },
  }),
}))
vi.mock("@tui/context/route", () => ({
  useRoute: () => ({
    get data() {
      return mocked.route
    },
    navigate: mocked.navigate,
  }),
}))
vi.mock("@tui/ui/toast", () => ({ useToast: () => ({ show: mocked.toast }) }))
vi.mock("@tui/ui/dialog", () => ({
  useDialog: () => ({
    get stack() {
      return mocked.stack
    },
    clear: mocked.clear,
    replace: mocked.replace,
    setSize: vi.fn(),
  }),
}))
vi.mock("@tui/ui/dialog-select", () => ({ DialogSelect: () => undefined }))
vi.mock("@/replay/query", () => ({ EventQuery: { bySessionWithTimestamp: () => [] } }))
vi.mock("../../../src/cli/tui/routes/session/route", () => ({
  routeNote: () => "Routing note",
  messageRoute: () => undefined,
}))

const disposers: Array<() => void> = []

function user(): UserMessage {
  return {
    id: "msg_one",
    sessionID: "ses_one",
    role: "user",
    time: { created: 1 },
    agent: "build",
    model: { providerID: "test", modelID: "model" },
  }
}

type Mode = "timeline-fork" | "message" | "timeline"

function mount(mode: Mode = "timeline-fork"): {
  dispose: () => void
  select: () => Promise<void>
  setSession: (value: string) => void
} {
  return createRoot((dispose) => {
    disposers.push(dispose)
    let sessionID = "ses_one"
    const props = {
      get sessionID() {
        return sessionID
      },
      messageID: "msg_one",
      onMove: mocked.move,
    }
    if (mode === "message") DialogMessage(props)
    else if (mode === "timeline") DialogTimeline(props)
    else DialogForkFromTimeline(props)
    const context = {
      get stack() {
        return mocked.stack
      },
      clear: mocked.clear,
    } as unknown as DialogContext
    const option = mocked.view!.options.find((item) => item.value === (mode === "message" ? "session.fork" : "msg_one"))
    return {
      dispose,
      select: () => Promise.resolve(option!.onSelect!(context)),
      setSession: (value) => {
        sessionID = value
      },
    }
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  mocked.directory = "/project"
  mocked.route = { type: "session", sessionID: "ses_one" }
  mocked.messages = { ses_one: [user()] }
  mocked.parts = {
    msg_one: [{ id: "part_one", messageID: "msg_one", sessionID: "ses_one", type: "text", text: "Original prompt" }],
  }
  mocked.stack = [{}]
  mocked.view = undefined
  vi.stubGlobal("React", {
    createElement: (_component: unknown, props: DialogSelectProps<string>) => {
      mocked.view = props
      return undefined
    },
  })
})

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  vi.unstubAllGlobals()
})

for (const mode of ["timeline-fork", "message"] as const) {
  test.each(["dispose", "dialog", "route", "directory", "session"] as const)(
    `${mode}: a late fork cannot take over after %s changes`,
    async (change) => {
      const pending = Promise.withResolvers<{ data: { id: string } }>()
      mocked.fork.mockReturnValue(pending.promise)
      const view = mount(mode)
      const completion = view.select()
      if (change === "dispose") view.dispose()
      if (change === "dialog") mocked.stack = [{}]
      if (change === "route") mocked.route = { type: "session", sessionID: "ses_other" }
      if (change === "directory") mocked.directory = "/other"
      if (change === "session") view.setSession("ses_other")
      pending.resolve({ data: { id: "forked" } })
      await completion
      expect(mocked.navigate).not.toHaveBeenCalled()
      expect(mocked.clear).not.toHaveBeenCalled()
      expect(mocked.toast).not.toHaveBeenCalled()
    },
  )

  test(`${mode}: captures prompt text and attachments before the projection is pruned`, async () => {
    const pending = Promise.withResolvers<{ data: { id: string } }>()
    mocked.fork.mockReturnValue(pending.promise)
    mocked.parts.msg_one.push(
      {
        id: "part_file",
        messageID: "msg_one",
        sessionID: "ses_one",
        type: "file",
        mime: "text/plain",
        url: "file:///test",
        filename: "test",
      },
      { id: "part_agent", messageID: "msg_one", sessionID: "ses_one", type: "agent", name: "build" },
    )
    const view = mount(mode)
    const completion = view.select()
    mocked.parts = {}
    pending.resolve({ data: { id: "forked" } })
    await completion
    expect(mocked.fork).toHaveBeenCalledExactlyOnceWith({ sessionID: "ses_one", messageID: "msg_one" })
    expect(mocked.navigate).toHaveBeenCalledWith({
      type: "session",
      sessionID: "forked",
      initialPrompt: {
        input: "Original prompt",
        parts: [
          { type: "file", mime: "text/plain", url: "file:///test", filename: "test" },
          { type: "agent", name: "build" },
        ],
      },
    })
    expect(mocked.clear).toHaveBeenCalledTimes(1)
  })

  test.each(["reject", "error", "missing"] as const)(`${mode}: surfaces a current %s failure`, async (kind) => {
    if (kind === "reject") mocked.fork.mockRejectedValue(new Error("Denied"))
    else mocked.fork.mockResolvedValue(kind === "error" ? { error: "Denied" } : {})
    await mount(mode).select()
    expect(mocked.toast).toHaveBeenCalledExactlyOnceWith({
      message: kind === "missing" ? "Failed to fork session" : "Denied",
      variant: "error",
    })
    expect(mocked.navigate).not.toHaveBeenCalled()
    expect(mocked.clear).not.toHaveBeenCalled()
  })

  test(`${mode}: suppresses late failures from a replaced dialog`, async () => {
    const pending = Promise.withResolvers<{ data: { id: string } }>()
    mocked.fork.mockReturnValue(pending.promise)
    const completion = mount(mode).select()
    mocked.stack = [{}]
    pending.reject(new Error("Late failure"))
    await completion
    expect(mocked.toast).not.toHaveBeenCalled()
  })

  test(`${mode}: preserves a dialog opened by navigation`, async () => {
    mocked.fork.mockResolvedValue({ data: { id: "forked" } })
    mocked.navigate.mockImplementation(() => {
      mocked.stack = [{}]
    })
    await mount(mode).select()
    expect(mocked.navigate).toHaveBeenCalledTimes(1)
    expect(mocked.clear).not.toHaveBeenCalled()
  })

  test(`${mode}: does not start a request without a dialog owner`, async () => {
    const view = mount(mode)
    mocked.stack = []
    await view.select()
    expect(mocked.fork).not.toHaveBeenCalled()
  })
}

for (const mode of ["timeline-fork", "timeline"] as const) {
  test(`${mode}: skips blank leading text and retains the visible title and timestamp`, () => {
    mocked.parts.msg_one.unshift({
      id: "part_empty",
      messageID: "msg_one",
      sessionID: "ses_one",
      type: "text",
      text: "  \n ",
    })
    mount(mode)
    expect(mocked.view!.options[0]).toMatchObject({ title: "Original prompt", value: "msg_one" })
    expect(mocked.view!.options[0].footer).toBeTruthy()
    if (mode === "timeline") expect(mocked.view!.options[0].description).toBe("Routing note")
  })

  test(`${mode}: renders a translated disabled empty state without moving the session`, () => {
    mocked.messages = {}
    mount(mode)
    const option = mocked.view!.options[0]
    expect(option).toMatchObject({
      title: mode === "timeline" ? "ui.noTimelineMessageAvailable" : "ui.noForkTargetAvailable",
      value: "empty",
      disabled: true,
    })
    mocked.view!.onMove!(option)
    expect(mocked.move).not.toHaveBeenCalled()
  })
}

test("timeline entries follow reverse projection order without mutating the source", () => {
  const first = { ...user(), id: "first", time: { created: 9 } }
  const last = { ...user(), id: "last", time: { created: 1 } }
  const messages = [first, last]
  const parts: Record<string, Part[]> = {
    first: [{ id: "p1", sessionID: "ses_one", messageID: "first", type: "text", text: "First\nline" }],
    last: [{ id: "p2", sessionID: "ses_one", messageID: "last", type: "text", text: "Last" }],
  }
  expect(timelineEntries(messages, parts)).toEqual([
    { message: last, title: "Last" },
    { message: first, title: "First line" },
  ])
  expect(messages).toEqual([first, last])
})

test("timeline entries exclude assistant, missing, attachment-only, hidden and blank content", () => {
  const assistant: Message = {
    id: "assistant",
    sessionID: "ses_one",
    role: "assistant",
    time: { created: 1 },
    parentID: "msg_one",
    modelID: "model",
    providerID: "test",
    mode: "build",
    agent: "build",
    path: { cwd: "/project", root: "/project" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
  const messages: Message[] = [assistant, ...["missing", "file", "hidden", "blank"].map((id) => ({ ...user(), id }))]
  const text = { id: "text", sessionID: "ses_one", messageID: "hidden", type: "text" as const, text: "Hidden" }
  expect(
    timelineEntries(messages, {
      assistant: [{ ...text, messageID: "assistant" }],
      file: [
        { id: "file", sessionID: "ses_one", messageID: "file", type: "file", mime: "text/plain", url: "file:///test" },
      ],
      hidden: [
        { ...text, synthetic: true },
        { ...text, id: "ignored", ignored: true },
      ],
      blank: [{ ...text, messageID: "blank", text: " \n " }],
    }),
  ).toEqual([])
})
