import { describe, expect, test } from "bun:test"
import { Usage } from "../../../src/cli/cmd/tui/routes/session/usage"

function assistant(input: {
  input?: number
  output?: number
  reasoning?: number
  read?: number
  write?: number
}) {
  return {
    role: "assistant",
    tokens: {
      input: input.input ?? 0,
      output: input.output ?? 0,
      reasoning: input.reasoning ?? 0,
      cache: {
        read: input.read ?? 0,
        write: input.write ?? 0,
      },
    },
  }
}

describe("Usage.total", () => {
  test("counts reasoning and cache tokens", () => {
    expect(
      Usage.total(
        assistant({
          input: 100,
          output: 50,
          reasoning: 25,
          read: 10,
          write: 5,
        }) as any,
      ),
    ).toBe(190)
  })
})

describe("Usage.last", () => {
  test("returns the last assistant message with reasoning-only usage", () => {
    const msgs = [
      { role: "user" },
      assistant({}),
      assistant({ reasoning: 120 }),
    ] as any[]

    expect(Usage.last(msgs as any)).toBe(msgs[2] as any)
  })

  test("returns the last assistant message with cache-only usage", () => {
    const msgs = [
      assistant({ input: 10 }),
      assistant({}),
      assistant({ read: 64 }),
    ] as any[]

    expect(Usage.last(msgs as any)).toBe(msgs[2] as any)
  })

  test("returns undefined when no assistant usage exists", () => {
    const msgs = [{ role: "user" }, assistant({})] as any[]

    expect(Usage.last(msgs as any)).toBeUndefined()
  })
})
