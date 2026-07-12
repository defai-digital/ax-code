import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

const sourcePath = path.resolve(__dirname, "ProjectActionsButton.tsx")

describe("ProjectActionsButton terminal guards", () => {
  test("coalesces PTY creation with mounted terminal views", async () => {
    const source = await readFile(sourcePath, "utf8")

    expect(source).toContain("ensureClaimedTerminalSession(normalizedDirectory, tabId")
    expect(source).toContain("claimSession:")
    expect(source).toContain("closeSession: terminal.close")
  })

  test("shares one output consumer and rejects stale session callbacks", async () => {
    const source = await readFile(sourcePath, "utf8")

    expect(source).toContain("terminalStreamConsumerKey(normalizedDirectory, tabId)")
    expect(source).toContain("expectedSessionId: runningSessionId")
    expect(source).toContain('lifecycle: "exited"')
  })
})
