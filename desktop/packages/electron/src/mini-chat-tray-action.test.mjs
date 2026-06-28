import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

const extractNewMiniChatBranch = (source) => {
  const match = source.match(/if \(action\.type === "new-mini-chat"\) \{(?<body>[\s\S]*?)\n  \}/)
  return match?.groups?.body ?? ""
}

describe("tray mini-chat action", () => {
  test("opens a draft mini-chat window directly instead of sending an orphan renderer event", async () => {
    const mainSource = await readFile(path.join(import.meta.dirname, "main.js"), "utf8")
    const branch = extractNewMiniChatBranch(mainSource)

    expect(branch).toContain('createMiniChatWindow({ mode: "draft" })')
    expect(branch).not.toContain("openchamber:open-mini-chat")
  })
})
