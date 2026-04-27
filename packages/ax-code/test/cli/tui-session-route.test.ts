import { describe, expect, test } from "bun:test"
import type { Part, UserMessage } from "@ax-code/sdk/v2"
import { messageRoute, routeEvent, routeNote, userRoute } from "../../src/cli/cmd/tui/routes/session/route"
import { activityItems } from "../../src/cli/cmd/tui/routes/session/activity"

function user(id: string, agent = "build"): UserMessage {
  return {
    id,
    sessionID: "s",
    role: "user",
    agent,
    model: {
      providerID: "openai",
      modelID: "gpt-5",
    },
    time: { created: 1 },
  }
}

function subtask(id: string, messageID: string, agent: string): Part {
  return {
    id,
    sessionID: "s",
    messageID,
    type: "subtask",
    prompt: "review this",
    description: "specialist review",
    agent,
  }
}

function tool(id: string, tool: string, start: number): Part {
  return {
    id,
    sessionID: "s",
    messageID: "u1",
    type: "tool",
    callID: `call:${id}`,
    tool,
    state: {
      status: "completed",
      title: `run ${tool}`,
      input: { command: tool },
      output: "ok",
      metadata: {},
      time: { start, end: start + 100 },
    },
  }
}

describe("tui session routing helpers", () => {
  test("summarizes delegated specialists without duplicates", () => {
    const route = userRoute(user("u1"), [subtask("p1", "u1", "perf"), subtask("p2", "u1", "perf")])
    expect(route.delegated).toEqual([{ id: "p1", name: "perf", label: "Perf" }])
  })

  test("builds factual timeline notes from message context", () => {
    expect(routeNote(user("u1"), [subtask("p1", "u1", "perf")])).toBe("Primary Build · specialist Perf")
    expect(routeNote(user("u1", "security"), [])).toBe("Primary Security")
    expect(routeNote(user("u1"), [])).toBe("")
  })

  test("treats the first agent in the list as the default — no spurious note for custom defaults", () => {
    // Agent.list sorts cfg.default_agent first; when user sets default to e.g. "engineer",
    // a message on "engineer" should produce no note (same as build did before).
    const agents = [{ name: "engineer" }, { name: "perf" }, { name: "security" }]
    expect(routeNote(user("u1", "engineer"), [], agents)).toBe("")
    expect(routeNote(user("u1", "perf"), [], agents)).toBe("Primary Perf")
    // Without an agents list, falls back to "build" — preserves existing call sites that don't pass agents.
    expect(routeNote(user("u1", "build"), [])).toBe("")
  })

  test("renders complexity events as the fast-model indicator", () => {
    // Only "complexity" events are emitted now; agent-routing was removed.
    // Legacy "switch"/"delegate" rows from older sessions still render as the same
    // fast-model indicator so historical replays don't crash.
    const item = routeEvent({
      time_created: 10,
      event_data: {
        type: "agent.route",
        sessionID: "s",
        messageID: "u1",
        fromAgent: "build",
        toAgent: "build",
        confidence: 0,
        routeMode: "complexity",
        complexity: "low",
      },
    })
    expect(item).toEqual({
      id: "route:10:complexity",
      mode: "complexity",
      icon: "⚡",
      title: "Fast model",
      detail: "simple task · Build",
      time: 10,
    })
  })

  test("messageRoute returns the latest agent.route event for a message", () => {
    const item = messageRoute(
      user("u1"),
      [],
      [
        {
          time_created: 10,
          event_data: {
            type: "agent.route",
            sessionID: "s",
            messageID: "u1",
            fromAgent: "build",
            toAgent: "build",
            confidence: 0,
            routeMode: "complexity",
            complexity: "low",
          },
        },
      ],
    )
    expect(item).toEqual({
      title: "Routing: Fast model",
      description: "simple task · Build",
      footer: "confidence 0.00",
    })
  })

  test("merges tool and route activity by timestamp", () => {
    const items = activityItems(
      [tool("t1", "bash", 20)],
      [
        {
          time_created: 30,
          event_data: {
            type: "agent.route",
            sessionID: "s",
            messageID: "u1",
            fromAgent: "build",
            toAgent: "build",
            confidence: 0,
            routeMode: "complexity",
            complexity: "low",
          },
        },
      ],
    )
    expect(items.map((item) => item.label)).toEqual(["Fast model", "run bash"])
    expect(items[1]?.status).toBe("completed")
  })
})
