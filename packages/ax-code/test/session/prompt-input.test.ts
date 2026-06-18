import { describe, expect, test } from "bun:test"
import { LoopInput, PromptInput } from "../../src/session/prompt-input"
import { SessionID } from "../../src/session/schema"

describe("session prompt input schema", () => {
  test("parses JSON string booleans from HTTP clients", () => {
    const prompt = PromptInput.parse({
      sessionID: SessionID.ascending(),
      userSelectedAgent: "true",
      noReply: "false",
      tools: {
        edit: "true",
        bash: "false",
      },
      isolation: {
        mode: "workspace-write",
        network: "false",
      },
      parts: [{ type: "text", text: "hello" }],
    })

    expect(prompt.userSelectedAgent).toBe(true)
    expect(prompt.noReply).toBe(false)
    expect(prompt.tools).toEqual({ edit: true, bash: false })
    expect(prompt.isolation).toEqual({ mode: "workspace-write", network: false })

    const loop = LoopInput.parse({
      sessionID: prompt.sessionID,
      resume_existing: "true",
    })
    expect(loop.resume_existing).toBe(true)
  })
})
