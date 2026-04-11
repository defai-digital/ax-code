import { expect, test } from "bun:test"
import { Archive } from "../../src/util/archive"

test("Archive.quote escapes single quotes for PowerShell", () => {
  expect(Archive.quote("C:\\tmp\\a'b.zip")).toBe("'C:\\tmp\\a''b.zip'")
})
