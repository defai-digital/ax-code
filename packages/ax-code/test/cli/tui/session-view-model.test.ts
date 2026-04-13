import { describe, expect, test } from "bun:test"
import {
  assistantMessageDuration,
  codeDisplayView,
  diffDisplayView,
  sessionTaskSummary,
  todoWriteView,
  userMessageView,
} from "../../../src/cli/cmd/tui/routes/session/view-model"

describe("tui session view model", () => {
  test("summarizes task tool state across transcript messages", () => {
    const messages = [
      { id: "msg_1", role: "assistant" },
      { id: "msg_2", role: "assistant" },
    ]
    const summary = sessionTaskSummary(messages, {
      msg_1: [
        { type: "tool", tool: "task", state: { status: "running" } },
        { type: "tool", tool: "task", state: { status: "completed" } },
      ] as any,
      msg_2: [
        { type: "tool", tool: "task", state: { status: "pending" } },
        { type: "tool", tool: "bash", state: { status: "completed" } },
      ] as any,
    })

    expect(summary).toEqual({ running: 2, done: 1, total: 3 })
  })

  test("derives user message metadata without renderer state", () => {
    const view = userMessageView({
      message: {
        id: "msg_1",
        sessionID: "ses_1",
        role: "user",
        agent: "build",
        model: { providerID: "anthropic", modelID: "claude" },
        time: { created: 1 },
      },
      parts: [
        { id: "part_1", sessionID: "ses_1", messageID: "msg_1", type: "text", text: "hello" },
        {
          id: "part_2",
          sessionID: "ses_1",
          messageID: "msg_1",
          type: "file",
          filename: "a.png",
          url: "file:///a.png",
          mime: "image/png",
        },
        {
          id: "part_3",
          sessionID: "ses_1",
          messageID: "msg_1",
          type: "subtask",
          agent: "perf",
          prompt: "profile it",
          description: "Perf review",
        },
      ],
      pending: "msg_0",
      showTimestamps: false,
      agents: [{ name: "perf", displayName: "Perf" }],
    })

    expect(view.text?.text).toBe("hello")
    expect(view.files.map((file) => file.filename)).toEqual(["a.png"])
    expect(view.queued).toBe(true)
    expect(view.showPrimary).toBe(true)
    expect(view.metadataVisible).toBe(true)
    expect(view.route.delegated).toEqual([{ id: "part_3", name: "perf", label: "Perf" }])
  })

  test("calculates assistant duration only for final messages", () => {
    const messages = [{ id: "user_1", role: "user", time: { created: 100 } }]
    const message = {
      id: "asst_1",
      sessionID: "ses_1",
      role: "assistant",
      agent: "build",
      modelID: "claude",
      providerID: "anthropic",
      mode: "",
      parentID: "user_1",
      path: { cwd: "/repo", root: "/repo" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      finish: "stop",
      time: { created: 110, completed: 250 },
    } as any

    expect(assistantMessageDuration(message, messages)).toBe(150)
    expect(assistantMessageDuration({ ...message, finish: "tool-calls" }, messages)).toBe(0)
  })

  test("uses todo metadata over input when rendering a completed todo write", () => {
    const view = todoWriteView({
      status: "completed",
      inputTodos: [],
      metadataTodos: [{ status: "in_progress", content: "Fix the TUI todo renderer" }],
    })

    expect(view).toEqual({
      state: "items",
      todos: [{ status: "in_progress", content: "Fix the TUI todo renderer" }],
    })
  })

  test("does not leave completed empty todo writes in a pending state", () => {
    expect(
      todoWriteView({
        status: "completed",
        inputTodos: [],
        metadataTodos: [],
      }),
    ).toEqual({
      state: "empty",
      todos: [],
    })
  })

  test("falls back to todo output for older completed tool parts", () => {
    const view = todoWriteView({
      status: "completed",
      output: JSON.stringify([{ status: "pending", content: "Review enterprise model list" }]),
    })

    expect(view).toEqual({
      state: "items",
      todos: [{ status: "pending", content: "Review enterprise model list" }],
    })
  })

  test("derives diff display metadata without renderer imports", () => {
    expect(
      diffDisplayView({
        diffStyle: "auto",
        width: 140,
        filePath: "src/app.tsx",
        wrapMode: "word",
      }),
    ).toEqual({
      view: "split",
      filetype: "typescript",
      wrapMode: "word",
    })

    expect(
      diffDisplayView({
        diffStyle: "stacked",
        width: 140,
        filePath: "src/app.tsx",
        wrapMode: "none",
      }).view,
    ).toBe("unified")
  })

  test("derives code display metadata without renderer imports", () => {
    expect(codeDisplayView({ filePath: "README.md", content: "# AX Code" })).toEqual({
      filetype: "markdown",
      content: "# AX Code",
    })
  })
})
