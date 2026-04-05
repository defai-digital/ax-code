import { describe, expect, test } from "bun:test"

import { createDialogLoader } from "./dialogs"

const deferred = <T,>() => {
  let done!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    done = resolve
  })
  return { promise, done }
}

describe("createDialogLoader", () => {
  test("shows the latest dialog only", async () => {
    const loader = createDialogLoader()
    const seen: string[] = []
    const a = deferred<string>()
    const b = deferred<string>()

    loader.open(() => a.promise, (mod) => seen.push(mod))
    loader.open(() => b.promise, (mod) => seen.push(mod))

    a.done("a")
    await Promise.resolve()
    expect(seen).toEqual([])

    b.done("b")
    await Promise.resolve()
    expect(seen).toEqual(["b"])
  })

  test("ignores dialogs after stop", async () => {
    const loader = createDialogLoader()
    const seen: string[] = []
    const task = deferred<string>()

    loader.open(() => task.promise, (mod) => seen.push(mod))
    loader.stop()
    task.done("a")

    await Promise.resolve()
    expect(seen).toEqual([])
  })
})
