import { test, expect, describe } from "bun:test"
import { promptToText } from "../../../src/provider/cli/prompt"
import type { LanguageModelV3Prompt } from "@ai-sdk/provider"

describe("promptToText", () => {
  test("extracts system message", () => {
    const prompt: LanguageModelV3Prompt = [{ role: "system", content: "You are a helpful assistant." }]
    expect(promptToText(prompt)).toBe("You are a helpful assistant.")
  })

  test("extracts user text parts", () => {
    const prompt: LanguageModelV3Prompt = [
      {
        role: "user",
        content: [
          { type: "text", text: "Hello" },
          { type: "text", text: "World" },
        ],
      },
    ]
    expect(promptToText(prompt)).toBe("Hello\nWorld")
  })

  test("skips non-text user parts", () => {
    const prompt: LanguageModelV3Prompt = [
      {
        role: "user",
        content: [
          { type: "text", text: "question" },
          { type: "file", data: new Uint8Array(), mediaType: "image/png" },
        ],
      },
    ]
    expect(promptToText(prompt)).toBe("question")
  })

  test("formats assistant text and reasoning", () => {
    const prompt: LanguageModelV3Prompt = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "answer" },
          { type: "reasoning", text: "thinking..." },
        ],
      },
    ]
    expect(promptToText(prompt)).toBe("[Assistant]: answer\nthinking...")
  })

  test("formats assistant tool calls", () => {
    const prompt: LanguageModelV3Prompt = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "1", toolName: "bash", input: { cmd: "ls" } },
        ],
      },
    ]
    expect(promptToText(prompt)).toBe('[Assistant]: [Tool: bash({"cmd":"ls"})]')
  })

  test("formats tool results", () => {
    const prompt: LanguageModelV3Prompt = [
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "1", toolName: "bash", output: { type: "json", value: { files: ["a.ts"] } } },
        ],
      },
    ]
    expect(promptToText(prompt)).toBe('[Tool Result: bash]: {"type":"json","value":{"files":["a.ts"]}}')
  })

  test("skips tool-approval-response parts in tool messages", () => {
    const prompt: LanguageModelV3Prompt = [
      {
        role: "tool",
        content: [
          { type: "tool-approval-response", approvalId: "1", approved: true },
          { type: "tool-result", toolCallId: "2", toolName: "read", output: { type: "text", value: "content" } },
        ],
      },
    ]
    expect(promptToText(prompt)).toBe('[Tool Result: read]: {"type":"text","value":"content"}')
  })

  test("combines multiple message types", () => {
    const prompt: LanguageModelV3Prompt = [
      { role: "system", content: "Be concise." },
      { role: "user", content: [{ type: "text", text: "Hi" }] },
      { role: "assistant", content: [{ type: "text", text: "Hello!" }] },
    ]
    const result = promptToText(prompt)
    expect(result).toBe("Be concise.\n\nHi\n\n[Assistant]: Hello!")
  })

  test("returns empty string for empty prompt", () => {
    expect(promptToText([])).toBe("")
  })

  test("skips empty user messages", () => {
    const prompt: LanguageModelV3Prompt = [
      { role: "user", content: [{ type: "file", data: new Uint8Array(), mediaType: "image/png" }] },
      { role: "user", content: [{ type: "text", text: "actual question" }] },
    ]
    expect(promptToText(prompt)).toBe("actual question")
  })
})
