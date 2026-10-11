import { describe, expect, test } from "vitest"
import { lazy } from "../../src/util/lazy"

describe("util.lazy", () => {
  test("should call function only once", () => {
    let callCount = 0
    const getValue = () => {
      callCount++
      return "expensive value"
    }

    const lazyValue = lazy(getValue)

    expect(callCount).toBe(0)

    const result1 = lazyValue()
    expect(result1).toBe("expensive value")
    expect(callCount).toBe(1)

    const result2 = lazyValue()
    expect(result2).toBe("expensive value")
    expect(callCount).toBe(1)
  })

  test("should preserve the same reference", () => {
    const obj = { value: 42 }
    const lazyObj = lazy(() => obj)

    const result1 = lazyObj()
    const result2 = lazyObj()

    expect(result1).toBe(obj)
    expect(result2).toBe(obj)
    expect(result1).toBe(result2)
  })

  test("peek observes an initialized value without triggering initialization", () => {
    let calls = 0
    const value = lazy(() => {
      calls++
      return { ready: true }
    })

    expect(value.loaded()).toBe(false)
    expect(value.peek()).toBeUndefined()
    expect(calls).toBe(0)

    const initialized = value()
    expect(value.loaded()).toBe(true)
    expect(value.peek()).toBe(initialized)

    value.reset()
    expect(value.loaded()).toBe(false)
    expect(value.peek()).toBeUndefined()
  })

  test("retries an async initializer after its promise rejects", async () => {
    let calls = 0
    const value = lazy(async () => {
      calls++
      if (calls === 1) throw new Error("transient")
      return "ready"
    })
    await expect(value()).rejects.toThrow("transient")
    expect(value.loaded()).toBe(false)
    await expect(value()).resolves.toBe("ready")
    expect(calls).toBe(2)
    await expect(value()).resolves.toBe("ready")
    expect(calls).toBe(2)
  })

  test("retries a function-valued thenable after it rejects", async () => {
    let calls = 0
    const value = lazy(() => {
      calls++
      const thenable = Object.assign(() => undefined, {
        then: (onFulfilled: (v: string) => void, onRejected: (e: unknown) => void) =>
          calls === 1 ? onRejected?.(new Error("transient")) : onFulfilled?.("ready"),
      })
      return thenable
    })
    await expect(Promise.resolve(value())).rejects.toThrow("transient")
    expect(value.loaded()).toBe(false)
    await expect(Promise.resolve(value())).resolves.toBe("ready")
  })

  test("should work with different return types", () => {
    const lazyString = lazy(() => "string")
    const lazyNumber = lazy(() => 123)
    const lazyBoolean = lazy(() => true)
    const lazyNull = lazy(() => null)
    const lazyUndefined = lazy(() => undefined)

    expect(lazyString()).toBe("string")
    expect(lazyNumber()).toBe(123)
    expect(lazyBoolean()).toBe(true)
    expect(lazyNull()).toBe(null)
    expect(lazyUndefined()).toBe(undefined)
  })

  test("retries initialization when inspecting a thenable throws", () => {
    let calls = 0
    const value = lazy(() => {
      calls++
      if (calls > 1) return { ready: true }
      return Object.defineProperty({}, "then", {
        get() {
          throw new Error("then lookup failed")
        },
      })
    })

    expect(() => value()).toThrow("then lookup failed")
    expect(value.loaded()).toBe(false)
    expect(value.peek()).toBeUndefined()
    expect(value()).toEqual({ ready: true })
    expect(calls).toBe(2)
  })

  test("retries initialization when subscribing to a thenable throws", () => {
    let calls = 0
    const value = lazy(() => {
      calls++
      if (calls > 1) return "ready"
      return {
        then() {
          throw new Error("then subscription failed")
        },
      }
    })

    expect(() => value()).toThrow("then subscription failed")
    expect(value.loaded()).toBe(false)
    expect(value.peek()).toBeUndefined()
    expect(value()).toBe("ready")
    expect(calls).toBe(2)
  })

  test("accepts foreign thenables that invoke their fulfillment callback", async () => {
    let calls = 0
    const thenable = {
      then(resolve: (value: string) => void) {
        resolve("ready")
      },
    }
    const value = lazy(() => {
      calls++
      return thenable
    })

    expect(value()).toBe(thenable)
    expect(value.loaded()).toBe(true)
    await expect(Promise.resolve(value())).resolves.toBe("ready")
    expect(calls).toBe(1)
  })
})
