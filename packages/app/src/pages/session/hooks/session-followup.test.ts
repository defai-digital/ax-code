import { describe, expect, test } from "bun:test"
import type { Prompt } from "@/context/prompt"
import {
  appendFollowup,
  editFollowupState,
  editingFollowup,
  failedFollowup,
  followupDock,
  followupPending,
  followupSending,
  getFollowup,
  getFollowupText,
  pausedFollowup,
  queueEnabled,
  queueFollowupState,
  queuedFollowups,
  removeFollowup,
  removeFollowupState,
  shouldAutoSendFollowup,
  updateRecentChecks,
} from "./session-followup"

const text = (content: string): Prompt[number] => ({
  type: "text",
  content,
  start: 0,
  end: content.length,
})

const image = (filename: string): Prompt[number] => ({
  type: "image",
  id: filename,
  filename,
  mime: "image/png",
  dataUrl: "data:",
})

describe("getFollowupText", () => {
  test("formats image and file prompts", () => {
    expect(
      getFollowupText(
        {
          sessionID: "s",
          sessionDirectory: "/tmp",
          context: [],
          agent: "build",
          model: { providerID: "openai", modelID: "gpt" },
          prompt: [image("a.png"), text(" hello ")],
        },
        "attachment",
      ),
    ).toBe("[image:a.png] hello")
  })

  test("falls back to attachment label", () => {
    expect(
      getFollowupText(
        {
          sessionID: "s",
          sessionDirectory: "/tmp",
          context: [],
          agent: "build",
          model: { providerID: "openai", modelID: "gpt" },
          prompt: [text("   ")],
        },
        "attachment",
      ),
    ).toBe("[attachment]")
  })
})

describe("followup list helpers", () => {
  test("appends and removes queued items", () => {
    const items = appendFollowup(
      [],
      {
        sessionID: "s",
        sessionDirectory: "/tmp",
        context: [],
        agent: "build",
        model: { providerID: "openai", modelID: "gpt" },
        prompt: [text("hello")],
      },
      "a",
    )

    expect(items.map((item) => item.id)).toEqual(["a"])
    expect(removeFollowup(items, "a")).toEqual([])
  })

  test("reads queued edit paused and failed state", () => {
    const items = appendFollowup(
      [],
      {
        sessionID: "s",
        sessionDirectory: "/tmp",
        context: [],
        agent: "build",
        model: { providerID: "openai", modelID: "gpt" },
        prompt: [text("hello")],
      },
      "a",
    )

    expect(queuedFollowups({ s: items }, "s", [])).toEqual(items)
    expect(editingFollowup({ s: { id: "a", prompt: items[0].prompt, context: [] } }, "s")).toEqual({
      id: "a",
      prompt: items[0].prompt,
      context: [],
    })
    expect(pausedFollowup({ s: true }, "s")).toBe(true)
    expect(failedFollowup({ s: "a" }, "s")).toBe("a")
    expect(getFollowup({ s: items }, "s", "a")).toEqual(items[0])
  })

  test("builds dock items and queue eligibility", () => {
    const items = appendFollowup(
      [],
      {
        sessionID: "s",
        sessionDirectory: "/tmp",
        context: [],
        agent: "build",
        model: { providerID: "openai", modelID: "gpt" },
        prompt: [text("hello")],
      },
      "a",
    )

    expect(followupDock(items, "attachment")).toEqual([{ id: "a", text: "hello" }])
    expect(queueEnabled({ sessionID: "s", mode: "queue", busy: true, blocked: false })).toBe(true)
    expect(queueEnabled({ sessionID: "s", mode: "send", busy: true, blocked: false })).toBe(false)
  })

  test("builds queue edit remove and pending state", () => {
    const item = {
      sessionID: "s",
      sessionDirectory: "/tmp",
      context: [],
      agent: "build",
      model: { providerID: "openai", modelID: "gpt" },
      prompt: [text("hello")],
    }

    expect(queueFollowupState([], item, "a")).toEqual({
      items: [{ ...item, id: "a" }],
      failed: undefined,
    })
    expect(followupPending(true, { sessionID: "s", id: "a" }, "s")).toBe(true)
    expect(followupSending(true, { sessionID: "s", id: "a" }, "s")).toBe("a")

    expect(editFollowupState([{ ...item, id: "a" }], "a", "a")).toEqual({
      items: [],
      failed: undefined,
      edit: {
        id: "a",
        prompt: item.prompt,
        context: [],
      },
    })

    expect(removeFollowupState([{ ...item, id: "a" }], "a", "a")).toEqual({
      items: [],
      failed: undefined,
    })
  })

  test("updates recent checks with dedupe and cap", () => {
    const out = updateRecentChecks(
      [
        { command: "pnpm test", title: "Tests" },
        { command: "pnpm lint", title: "Lint" },
      ],
      { command: "pnpm test", title: "Test again" },
    )

    expect(out).toEqual([
      { command: "pnpm test", title: "Test again" },
      { command: "pnpm lint", title: "Lint" },
    ])
  })
})

describe("shouldAutoSendFollowup", () => {
  test("allows ready queued item", () => {
    expect(
      shouldAutoSendFollowup({
        item: { id: "a" },
        sending: false,
        failed: undefined,
        paused: false,
        blocked: false,
        busy: false,
      }),
    ).toBe(true)
  })

  test("blocks paused failed or busy items", () => {
    expect(
      shouldAutoSendFollowup({
        item: { id: "a" },
        sending: false,
        failed: "a",
        paused: false,
        blocked: false,
        busy: false,
      }),
    ).toBe(false)
    expect(
      shouldAutoSendFollowup({
        item: { id: "a" },
        sending: false,
        failed: undefined,
        paused: true,
        blocked: false,
        busy: false,
      }),
    ).toBe(false)
    expect(
      shouldAutoSendFollowup({
        item: { id: "a" },
        sending: false,
        failed: undefined,
        paused: false,
        blocked: true,
        busy: false,
      }),
    ).toBe(false)
    expect(
      shouldAutoSendFollowup({
        item: { id: "a" },
        sending: true,
        failed: undefined,
        paused: false,
        blocked: false,
        busy: false,
      }),
    ).toBe(false)
  })
})
