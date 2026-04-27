import { describe, expect, test } from "bun:test"
import { detectAmbiguity, shouldClarify, build } from "../../src/question/clarify"
import { Question } from "../../src/question"

describe("question.clarify.detectAmbiguity", () => {
  test("flags vague action verbs without scope", () => {
    expect(detectAmbiguity("refactor the auth module")).toEqual({
      reason: "vague-action",
      evidence: "refactor",
    })
    expect(detectAmbiguity("clean up everything")?.reason).toBe("vague-action")
  })

  test("ignores vague verbs when scope is anchored", () => {
    expect(detectAmbiguity("refactor src/auth/login.ts to extract a helper")).toBeNull()
    expect(detectAmbiguity("fix the regex in parser.ts only")).toBeNull()
  })

  test("flags explicit ambiguity phrases", () => {
    const hint = detectAmbiguity("you decide what's best")
    expect(hint?.reason).toBe("explicit-ambiguity")
  })

  test("does not flag concrete one-line questions", () => {
    expect(detectAmbiguity("Why does parser.ts emit a duplicate token?")).toBeNull()
  })

  test("flags very short broad requests", () => {
    expect(detectAmbiguity("speed it up")?.reason).toBe("broad-scope")
  })

  test("shouldClarify mirrors detectAmbiguity boolean", () => {
    expect(shouldClarify("refactor the auth module")).toBe(true)
    expect(shouldClarify("rename the function `foo` to `bar` in src/util.ts")).toBe(false)
  })
})

describe("question.clarify.build", () => {
  test("first option gets (Recommended) suffix", () => {
    const info = build({
      topic: "scope",
      why: "Which subset of the auth module should I refactor?",
      options: [
        { label: "Login flow only", description: "Touch only login.ts" },
        { label: "Whole module", description: "Refactor the full auth/" },
      ],
    })
    expect(info.options[0].label).toBe("Login flow only (Recommended)")
    expect(info.options[1].label).toBe("Whole module")
    expect(info.header).toBe("scope")
  })

  test("does not double-annotate (Recommended)", () => {
    const info = build({
      topic: "scope",
      why: "?",
      options: [
        { label: "Already (Recommended)", description: "A" },
        { label: "Other", description: "B" },
      ],
    })
    expect(info.options[0].label).toBe("Already (Recommended)")
  })

  test("rejects fewer than 2 or more than 4 options", () => {
    expect(() =>
      build({
        topic: "x",
        why: "y",
        options: [{ label: "a", description: "a" }],
      }),
    ).toThrow(/at least 2/)

    expect(() =>
      build({
        topic: "x",
        why: "y",
        options: Array.from({ length: 5 }, (_, i) => ({
          label: `o${i}`,
          description: "x",
        })),
      }),
    ).toThrow(/at most 4/)
  })

  test("Question namespace re-exports helpers", () => {
    expect(Question.shouldClarify("refactor everything")).toBe(true)
    const info = Question.buildClarification({
      topic: "approach",
      why: "Which approach fits?",
      options: [
        { label: "Targeted patch", description: "Small change only" },
        { label: "Architecture rewrite", description: "Bigger refactor" },
      ],
    })
    expect(info.options[0].label).toContain("Recommended")
  })

  test("autonomous answers prefer the (Recommended) first option", () => {
    const info = build({
      topic: "approach",
      why: "Which approach?",
      options: [
        { label: "Minimal patch", description: "Common safe change" },
        { label: "Architecture rewrite", description: "Complex large refactor" },
      ],
    })
    const answers = Question.autonomousAnswers([info])
    expect(answers[0]).toEqual(["Minimal patch (Recommended)"])
  })
})
