import { createRequire } from "node:module"
import { runInNewContext } from "node:vm"
import { expect, test } from "vitest"

const require = createRequire(import.meta.url)
const solidRequire = createRequire(require.resolve("solid-js"))
const { serialize } = solidRequire("seroval") as { serialize(value: unknown): string }

test("Solid's serializer does not trust a typed array's own constructor", () => {
  const value = new Uint8Array([1, 2])
  Object.defineProperty(value, "constructor", { value: { name: "unexpectedConstructor" } })
  const output = serialize(value)
  expect(output).not.toContain("unexpectedConstructor")
  expect(Array.from(runInNewContext(output, { atob }) as Uint8Array)).toEqual([1, 2])
})

test("Solid's serializer escapes RegExp sources without breaking named groups", () => {
  const value = new RegExp("(?<name>safe)")
  const output = serialize(value)
  expect(output).not.toContain("<")
  expect((runInNewContext(output) as RegExp).exec("safe")?.groups?.name).toBe("safe")
})
