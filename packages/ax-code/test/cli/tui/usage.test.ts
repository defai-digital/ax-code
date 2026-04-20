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
  test("counts input, output, and cache tokens (excludes reasoning)", () => {
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
    ).toBe(165)
  })

  test("uses tokens.total when available", () => {
    const msg = assistant({ input: 100, output: 50 }) as any
    msg.tokens.total = 200
    expect(Usage.total(msg)).toBe(200)
  })

  test("treats missing cache tokens as zero", () => {
    const msg = assistant({ input: 10, output: 5 }) as any
    delete msg.tokens.cache
    expect(Usage.total(msg)).toBe(15)
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
