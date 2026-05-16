import { describe, expect, test } from "bun:test"
import { AutonomousQuestion } from "../../src/question/autonomous"

describe("autonomous question evaluation fixtures", () => {
  test("prefers best-practice options and avoids over-engineering", () => {
    const fixtures: Array<{
      name: string
      question: AutonomousQuestion.QuestionLike
      expected: string[]
      confidence: AutonomousQuestion.Confidence
    }> = [
      {
        name: "recommended safe option",
        question: {
          question: "Which implementation should we use?",
          header: "Approach",
          options: [
            { label: "Prototype rewrite", description: "Complex large refactor" },
            { label: "Recommended patch", description: "Safe common practice" },
          ],
        },
        expected: ["Recommended patch"],
        confidence: "high",
      },
      {
        name: "context asks for low scope",
        question: {
          question: "Which approach best avoids over-engineering?",
          header: "Approach",
          options: [
            { label: "Architecture layer", description: "Framework layer for future extension" },
            { label: "Patch existing function", description: "Small targeted change" },
          ],
        },
        expected: ["Patch existing function"],
        confidence: "high",
      },
      {
        name: "risky recommendation loses to focused patch",
        question: {
          question: "Which approach?",
          header: "Approach",
          options: [
            { label: "Rewrite (Recommended)", description: "Complex large refactor" },
            { label: "Focused patch", description: "Targeted fix only" },
          ],
        },
        expected: ["Focused patch"],
        confidence: "high",
      },
      {
        name: "multi-select keeps only positive low-risk options",
        question: {
          question: "Which actions?",
          header: "Actions",
          multiple: true,
          options: [
            { label: "Rewrite (Recommended)", description: "Complex large refactor" },
            { label: "Add focused test", description: "Simple best practice" },
            { label: "Minimal fix", description: "Common safe change" },
          ],
        },
        expected: ["Add focused test", "Minimal fix"],
        confidence: "high",
      },
      {
        name: "generic avoid wording selects the option to avoid",
        question: {
          question: "Which option should we avoid mentioning in release notes?",
          header: "Avoid",
          options: [
            { label: "Internal codename", description: "Small internal-only detail" },
            { label: "User-facing fix", description: "Common release-note detail" },
          ],
        },
        expected: ["Internal codename"],
        confidence: "high",
      },
      {
        name: "not mention wording selects the option to omit",
        question: {
          question: "Which detail should we not mention in the final summary?",
          header: "Summary",
          options: [
            { label: "Private implementation detail", description: "Internal-only mechanism" },
            { label: "User-visible behavior", description: "Safe summary detail" },
          ],
        },
        expected: ["Private implementation detail"],
        confidence: "high",
      },
    ]

    const decisions = AutonomousQuestion.decisions(fixtures.map((fixture) => fixture.question))
    for (const [index, fixture] of fixtures.entries()) {
      expect(decisions[index].answer, fixture.name).toEqual(fixture.expected)
      expect(decisions[index].confidence, fixture.name).toBe(fixture.confidence)
      expect(decisions[index].rationale, fixture.name).toBeTruthy()
    }
  })
})
