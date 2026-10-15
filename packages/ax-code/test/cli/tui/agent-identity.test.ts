import { describe, expect, test } from "vitest"
import { AGENT_COLOR_THEME_KEYS, agentIcon } from "../../../src/cli/tui/context/local-util"

// Agent identity marks must be printable ASCII (0x21-0x7E): exactly one code
// point, no VS16, never astral emoji or ambiguous-width marks — both drift
// terminal cell width.
const isSingleWidthAscii = (mark: string) => {
  if (mark.length !== 1) return false
  const code = mark.codePointAt(0) ?? 0
  return code >= 0x21 && code <= 0x7e
}

describe("agent identity marks", () => {
  const knownAgents = [
    "build",
    "plan",
    "general",
    "explore",
    "react",
    "security",
    "architect",
    "debug",
    "perf",
    "devops",
    "test",
  ]

  test("maps every known agent to a distinct single-width ASCII mark", () => {
    const marks = knownAgents.map(agentIcon)
    expect(new Set(marks).size).toBe(knownAgents.length)
    for (const mark of marks) expect(isSingleWidthAscii(mark)).toBe(true)
  })

  test("falls back to the general mark for unknown agents", () => {
    expect(agentIcon("does-not-exist")).toBe(agentIcon("general"))
  })
})

describe("agent identity colour rotation", () => {
  test("rotates identity hues only, never status hues", () => {
    expect([...AGENT_COLOR_THEME_KEYS]).toEqual(["secondary", "accent", "success", "primary", "info"])
    expect(AGENT_COLOR_THEME_KEYS).not.toContain("error")
    expect(AGENT_COLOR_THEME_KEYS).not.toContain("warning")
    expect(new Set(AGENT_COLOR_THEME_KEYS).size).toBe(AGENT_COLOR_THEME_KEYS.length)
  })
})
