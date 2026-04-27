import { describe, expect, test } from "bun:test"
import { detectCycle, type RingEntry } from "../../src/session/cycle-detection"

const e = (tool: string, input: string = "{}"): RingEntry => ({ tool, input })

describe("cycle-detection", () => {
  test("returns null for empty input", () => {
    expect(detectCycle([])).toBeNull()
  })

  test("k=1 needs DOOM_LOOP_THRESHOLD identical calls (3) to trigger", () => {
    expect(detectCycle([e("a"), e("a")])).toBeNull()
    expect(detectCycle([e("a"), e("a"), e("a")])).toBe(1)
  })

  test("k=1 distinguishes tool name", () => {
    expect(detectCycle([e("a"), e("a"), e("b")])).toBeNull()
  })

  test("k=1 distinguishes input string", () => {
    expect(detectCycle([e("a", "x"), e("a", "x"), e("a", "y")])).toBeNull()
  })

  test("k=2 detects A,B,A,B with two repeats", () => {
    expect(detectCycle([e("a"), e("b"), e("a"), e("b")])).toBe(2)
  })

  test("k=2 needs at least two full repeats", () => {
    expect(detectCycle([e("a"), e("b"), e("a")])).toBeNull()
  })

  test("k=3 detects A,B,C,A,B,C", () => {
    expect(detectCycle([e("a"), e("b"), e("c"), e("a"), e("b"), e("c")])).toBe(3)
  })

  test("non-cyclical sequences do not trigger", () => {
    expect(detectCycle([e("a"), e("b"), e("c"), e("d"), e("e"), e("f")])).toBeNull()
  })

  test("legitimate retry-test loop with different inputs does not trigger", () => {
    // edit -> typecheck -> edit (different inputs each time): no cycle
    const seq = [e("edit", "input1"), e("typecheck"), e("edit", "input2"), e("typecheck"), e("edit", "input3")]
    expect(detectCycle(seq)).toBeNull()
  })

  test("respects maxCycleLen parameter", () => {
    // A,B,C,A,B,C is a k=3 cycle; passing maxCycleLen=2 should not detect it.
    expect(detectCycle([e("a"), e("b"), e("c"), e("a"), e("b"), e("c")], 2)).toBeNull()
  })
})
