import { describe, expect, test } from "vitest"
import { lazy } from "../src/lazy"

describe("lazy", () => {
  test("computes once and memoizes", () => {
    let calls = 0
    const get = lazy(() => {
      calls += 1
      return calls * 10
    })
    expect(get()).toBe(10)
    expect(get()).toBe(10)
    expect(calls).toBe(1)
  })

  test("memoizes falsy values", () => {
    let calls = 0
    const getZero = lazy(() => {
      calls += 1
      return 0
    })
    expect(getZero()).toBe(0)
    expect(getZero()).toBe(0)
    expect(calls).toBe(1)
  })

  test("retries after a synchronous failure", () => {
    let calls = 0
    const get = lazy(() => {
      calls += 1
      if (calls === 1) throw new Error("first attempt fails")
      return "ok"
    })
    expect(() => get()).toThrow("first attempt fails")
    expect(get()).toBe("ok")
    expect(get()).toBe("ok")
    expect(calls).toBe(2)
  })
})
