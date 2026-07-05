import { describe, expect, it } from "vitest"
import { getFileHunks, revertHunk } from "./diffHunkRevert"

// 20 unchanged lines with a wide gap between the two edits: this diff library
// merges hunks that are closer than its internal context threshold, so the
// gap here must be large enough to keep them as two distinct hunks.
const lineCount = 20
const originalLines = Array.from({ length: lineCount }, (_, i) => `line${i + 1}`)
const original = originalLines.join("\n")

const modifiedLines = [...originalLines]
modifiedLines[1] = "line2-edited" // near the start
modifiedLines[lineCount - 2] = `line${lineCount - 1}-edited` // near the end
const modified = modifiedLines.join("\n")

describe("diffHunkRevert", () => {
  it("parses two separate hunks", () => {
    const hunks = getFileHunks(original, modified, "file.txt")
    expect(hunks).toHaveLength(2)
  })

  it("reverts only the targeted hunk, leaving the other intact", () => {
    const reverted = revertHunk(original, modified, 0, "file.txt")
    expect(reverted).toContain("line2\n")
    expect(reverted).not.toContain("line2-edited")
    expect(reverted).toContain(`line${lineCount - 1}-edited`)
  })

  it("reverting the last remaining hunk restores the original file exactly", () => {
    const afterFirstRevert = revertHunk(original, modified, 0, "file.txt")
    const hunksAfterFirstRevert = getFileHunks(original, afterFirstRevert, "file.txt")
    expect(hunksAfterFirstRevert).toHaveLength(1)

    const afterSecondRevert = revertHunk(original, afterFirstRevert, 0, "file.txt")
    expect(afterSecondRevert).toBe(original)
  })
})
