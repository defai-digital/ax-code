import { describe, expect, test } from "vitest"

import { BehaviorAutosaveSequence } from "./behaviorAutosaveSequence"

describe("BehaviorAutosaveSequence", () => {
  test("only treats the latest autosave token as current", () => {
    const sequence = new BehaviorAutosaveSequence()

    const stale = sequence.begin()
    const latest = sequence.begin()

    expect(sequence.isCurrent(stale)).toBe(false)
    expect(sequence.isCurrent(latest)).toBe(true)
  })

  test("does not let a stale completion clear a newer autosave", () => {
    const sequence = new BehaviorAutosaveSequence()

    const stale = sequence.begin()
    const latest = sequence.begin()

    expect(sequence.complete(stale)).toBe(false)
    expect(sequence.isCurrent(latest)).toBe(true)
    expect(sequence.complete(latest)).toBe(true)
    expect(sequence.isCurrent(latest)).toBe(false)
  })

  test("cancels the active autosave token", () => {
    const sequence = new BehaviorAutosaveSequence()
    const token = sequence.begin()

    sequence.cancel(token)

    expect(sequence.isCurrent(token)).toBe(false)
    expect(sequence.complete(token)).toBe(false)
  })

  test("cancels the active token without starting a new autosave", () => {
    const sequence = new BehaviorAutosaveSequence()
    const token = sequence.begin()

    sequence.cancelActive()

    expect(sequence.isCurrent(token)).toBe(false)
  })
})
