import { describe, expect, test } from "bun:test"
import { Gate } from "../../../src/cli/cmd/tui/component/prompt/gate"

describe("prompt gate", () => {
  test("drops concurrent submits while one is in flight", async () => {
    let count = 0
    let done!: () => void
    const wait = new Promise<void>((resolve) => {
      done = resolve
    })
    const submit = Gate.create(async (text: string) => {
      count++
      await wait
      return text
    })

    const first = submit("hello")
    const second = submit("hello")

    expect(count).toBe(1)
    expect(await second).toBeUndefined()

    done()

    expect(await first).toBe("hello")
  })

  test("allows another submit after the first finishes", async () => {
    const seen: string[] = []
    const submit = Gate.create(async (text: string) => {
      seen.push(text)
      return text
    })

    expect(await submit("one")).toBe("one")
    expect(await submit("two")).toBe("two")
    expect(seen).toEqual(["one", "two"])
  })
})
