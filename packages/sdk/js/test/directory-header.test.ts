import { describe, expect, test } from "vitest"
import { encodeDirectoryHeader } from "../src/protocol"

describe("encodeDirectoryHeader", () => {
  test("keeps a plain ASCII path as-is", () => {
    expect(encodeDirectoryHeader("/tmp/project")).toBe("/tmp/project")
  })

  test("encodes a literal percent so the server's decode restores it", () => {
    const encoded = encodeDirectoryHeader("/tmp/x%41y")
    expect(decodeURIComponent(encoded)).toBe("/tmp/x%41y")
  })
})
