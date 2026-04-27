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

  test("formats replayed route events for activity history", () => {
    const item = routeEvent({
      time_created: 10,
      event_data: {
        type: "agent.route",
        sessionID: "s",
        messageID: "u1",
        fromAgent: "build",
        toAgent: "perf",
        confidence: 0.92,
        routeMode: "delegate",
        matched: ["performance", "profile"],
      },
    })
    expect(item).toEqual({
      id: "route:10:perf",
      mode: "delegate",
      icon: "↳",
      title: "Delegated Perf",
      detail: "Kept Build active · performance, profile",
      time: 10,
    })
  })

  test("builds message-level routing details from exact message events", () => {
    const item = messageRoute(
      user("u1"),
      [subtask("p1", "u1", "perf")],
      [
        {
          time_created: 10,
          event_data: {
            type: "agent.route",
            sessionID: "s",
            messageID: "u1",
            fromAgent: "build",
            toAgent: "perf",
            confidence: 0.92,
            routeMode: "delegate",
            matched: ["performance", "profile"],
          },
        },
      ],
    )
    expect(item).toEqual({
      title: "Routing: Delegated Perf",
      description: "Kept Build active · performance, profile",
      footer: "confidence 0.92 · performance, profile",
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
            toAgent: "security",
            confidence: 0.88,
            routeMode: "switch",
            matched: ["security", "scan"],
          },
        },
      ],
    )
    expect(items.map((item) => item.label)).toEqual(["Switched primary to Security", "run bash"])
    expect(items[0]?.status).toBe("switch")
    expect(items[1]?.status).toBe("completed")
  })
})
