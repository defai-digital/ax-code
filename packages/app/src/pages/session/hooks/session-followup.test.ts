import { describe, expect, test } from "bun:test"
import type { Prompt } from "@/context/prompt"
import {
  appendFollowup,
  getFollowupText,
  removeFollowup,
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
