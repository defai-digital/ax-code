import { expect, test } from "vitest"
import { duplicateSessionHints } from "../../../src/cli/tui/component/session-list-data"

test("only colliding titles receive distinct stable identities", () => {
  const sessions = [
    { id: "ses_alpha1234", title: "Review" },
    { id: "ses_beta1234", title: " review " },
    { id: "ses_unique", title: "Implementation" },
  ]
  const hints = duplicateSessionHints(sessions)
  expect(hints.size).toBe(2)
  expect(hints.get(sessions[0].id)).not.toBe(hints.get(sessions[1].id))
  expect(hints.has("ses_unique")).toBe(false)
  expect(duplicateSessionHints([...sessions].reverse())).toEqual(hints)
})

test("handles short identities and duplicate records without unnecessary hints", () => {
  expect(
    duplicateSessionHints([
      { id: "a", title: "Task" },
      { id: "a", title: "Task" },
    ]).size,
  ).toBe(0)
  expect([
    ...duplicateSessionHints([
      { id: "a", title: "Task" },
      { id: "ba", title: "Task" },
    ]).values(),
  ]).toEqual(["a", "ba"])
})
