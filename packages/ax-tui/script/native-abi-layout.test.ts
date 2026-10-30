import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { ABI_STRUCTS, layoutOf, parseAbiStructs, readAbiLayout } from "./native-abi-layout.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

test("FFI field layout inserts C padding before a more-aligned field", () => {
  const layout = layoutOf([
    { name: "width", size: 1 },
    { name: "char", size: 4 },
  ])
  expect(layout).toEqual({
    size: 8,
    alignment: 4,
    fields: [
      { name: "width", offset: 0, size: 1, alignment: 1 },
      { name: "char", offset: 4, size: 4, alignment: 4 },
    ],
  })
})

test("every bun-ffi struct is in the committed native layout contract", () => {
  const source = readFileSync(join(root, "src/core/zig-structs.ts"), "utf8")
  const parsed = parseAbiStructs(source)
  expect(parsed.structs.map((item) => item.zig)).toEqual(Object.values(ABI_STRUCTS))
  expect(parsed).toEqual(readAbiLayout())
})
