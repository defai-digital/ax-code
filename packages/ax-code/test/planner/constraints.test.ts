import { describe, expect, test } from "bun:test"
import { Planner } from "../../src/planner"
import { Question } from "../../src/question"

describe("planner constraints", () => {
  test("create stores constraints on the plan", () => {
    const plan = Planner.create("refactor auth", [{ name: "extract" }, { name: "migrate" }], {
      constraints: ["preserve backward compatibility", "no DB schema changes"],
    })
    expect(plan.constraints).toEqual(["preserve backward compatibility", "no DB schema changes"])
  })

  test("create omits constraints when none supplied", () => {
    const plan = Planner.create("refactor auth", [{ name: "extract" }])
    expect(plan.constraints).toBeUndefined()
  })

  test("trims and drops empty constraints", () => {
    const plan = Planner.create("refactor", [{ name: "x" }], { constraints: ["  preserve API  ", "", "   "] })
    expect(plan.constraints).toEqual(["preserve API"])
  })

  test("Question.toConstraints turns Q&A into clean strings", () => {
    const questions = [
      Question.buildClarification({
        topic: "scope",
        why: "Which subset to refactor?",
        options: [
          { label: "Login flow only", description: "Touch only login.ts" },
          { label: "Whole module", description: "Refactor the full auth/" },
        ],
      }),
      Question.buildClarification({
        topic: "compat",
        why: "Backward compatibility?",
        options: [
          { label: "Required", description: "Must not break callers" },
          { label: "Not required", description: "Free to change API" },
        ],
      }),
    ]
    const answers: Question.Answer[] = [["Login flow only (Recommended)"], ["Required (Recommended)"]]
    const constraints = Question.toConstraints(questions, answers)
    expect(constraints).toEqual(["scope: Login flow only", "compat: Required"])
  })

  test("Question.toConstraints handles multi-select answers", () => {
    const q = Question.buildClarification({
      topic: "tests",
      why: "Which test layers?",
      options: [
        { label: "Unit", description: "Function-level" },
        { label: "Integration", description: "Module-level" },
      ],
      multiple: true,
    })
    const out = Question.toConstraints([q], [["Unit (Recommended)", "Integration"]])
    expect(out).toEqual(["tests: Unit, Integration"])
  })

  test("Question.toConstraints tolerates length mismatch", () => {
    const q = Question.buildClarification({
      topic: "x",
      why: "?",
      options: [
        { label: "a", description: "a" },
        { label: "b", description: "b" },
      ],
    })
    expect(Question.toConstraints([q], [])).toEqual([])
    expect(Question.toConstraints([], [["a"]])).toEqual([])
    expect(Question.toConstraints([q], [[]])).toEqual([])
  })

  test("end-to-end: clarification answers feed into plan constraints", () => {
    const q = Question.buildClarification({
      topic: "scope",
      why: "Which subset to refactor?",
      options: [
        { label: "Login flow only", description: "Targeted" },
        { label: "Whole module", description: "Broad refactor" },
      ],
    })
    const answers: Question.Answer[] = [["Login flow only (Recommended)"]]
    const constraints = Question.toConstraints([q], answers)
    const plan = Planner.create("refactor auth", [{ name: "phase A" }, { name: "phase B" }], { constraints })
    expect(plan.constraints).toEqual(["scope: Login flow only"])
  })
})
