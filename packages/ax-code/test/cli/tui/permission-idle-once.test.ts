import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"

// ADR-138: the permission prompt renders the server's idle "Allow once"
// countdown. The prompt requires AX Code TUI native FFI to render, so these
// are source-text guards like p-permission-question-reply-sdk-error.test.ts.
const SRC = path.join(__dirname, "../../../src/cli/tui/routes/session/permission.tsx")

describe("permission idle-once countdown", () => {
  test("the once option shows the remaining seconds and the server stays authoritative", async () => {
    const src = await fs.readFile(SRC, "utf8")

    // Countdown label interpolation on the once option.
    expect(src).toContain('t("permission.onceCountdown", { seconds: String(seconds) })')
    // Without a server deadline the label falls back to the plain string.
    expect(src).toContain("seconds === undefined")

    // The tick is keyed to the request id and cleaned up on swap/unmount.
    expect(src).toContain("() => props.request.id")
    expect(src).toContain("onCleanup(() => clearInterval(interval))")

    // The client must never submit the auto-reply itself: the server deadline
    // is authoritative (first-writer-wins against human replies), so the
    // countdown effect may not call any reply/submit path.
    const effectStart = src.indexOf("const [secondsLeft, setSecondsLeft]")
    const effectEnd = src.indexOf("const baseOptions", effectStart)
    expect(effectStart).toBeGreaterThanOrEqual(0)
    expect(effectEnd).toBeGreaterThan(effectStart)
    const effectBody = src.slice(effectStart, effectEnd)
    expect(effectBody).not.toContain("permission.reply")
    expect(effectBody).not.toContain("submitPermissionReply")
  })
})
