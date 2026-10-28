import { expect, test } from "vitest"
import { autonomousDecisionLedgerReminder } from "../../src/session/prompt/prompt-autonomous-ledger"

function ledgerFor(decision: Record<string, unknown>) {
  return autonomousDecisionLedgerReminder([
    {
      info: { id: "msg_1", role: "assistant" },
      parts: [
        {
          type: "tool",
          tool: "question",
          state: { status: "completed", metadata: { autonomousDecisions: [decision] } },
        },
      ],
    },
  ] as never)
}

test("a truncated decision never ends in a broken entity or a lone surrogate", () => {
  const ledger = ledgerFor({
    question: "Pick one",
    selected: ["a".repeat(119) + '"', "b".repeat(119) + "😀"],
    rationale: "c".repeat(239) + "😀",
  })
  expect(ledger).toBeDefined()
  expect(ledger).not.toMatch(/&(?!lt;|gt;|quot;|amp;)\w*\.\.\./)
  expect(ledger).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
})
