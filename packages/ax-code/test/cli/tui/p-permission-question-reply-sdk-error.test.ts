import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"

// The v2 SDK client resolves { error } instead of rejecting when throwOnError
// is unset (the default), so the reply/reject calls in the permission and
// question prompts return a resolved value on HTTP/network failure rather than
// throwing. Before the fix, submitPermissionReply/submitQuestionRequest ran
// their success `.then` on those failures — splicing the request out of the
// sync store (removeRequestLocally) and unmounting the prompt while the
// server-side ask stayed pending, wedging the agent with no toast. These are
// source-text guards (the prompts require the opentui native FFI to render, so
// they cannot be imported into a unit test) locking in the routing: inspect
// the resolved result.error and throw so the existing `.catch` (reset guard,
// log, toast, keep the prompt mounted for retry) handles the failure.
const TUI_ROOT = path.join(__dirname, "../../../src/cli/cmd/tui")
const PERMISSION_PROMPT_SRC = path.join(TUI_ROOT, "routes/session/permission.tsx")
const QUESTION_PROMPT_SRC = path.join(TUI_ROOT, "routes/session/question.tsx")

describe("permission/question prompt reply SDK error routing", () => {
  test("permission reply inspects result.error and throws into the failure path", async () => {
    const src = await fs.readFile(PERMISSION_PROMPT_SRC, "utf8")

    // The resolved SDK value is inspected instead of being treated as success.
    expect(src).toContain("const error = (result as { error?: unknown } | undefined)?.error")
    expect(src).toContain("if (error) throw replyError(error, failureMessage)")
    // A resolved error must be routed before the prompt is unmounted.
    const throwIndex = src.indexOf("if (error) throw replyError(error, failureMessage)")
    const removeIndex = src.indexOf("removeRequestLocally(sessionID, id)", throwIndex)
    expect(throwIndex).toBeGreaterThanOrEqual(0)
    expect(removeIndex).toBeGreaterThan(throwIndex)
    // The helper carries the server message into the existing error toast.
    expect(src).toContain("function replyError(error: unknown, fallback: string): Error")
  })

  test("question reply and reject inspect result.error and throw into the failure path", async () => {
    const src = await fs.readFile(QUESTION_PROMPT_SRC, "utf8")

    expect(src).toContain("const error = (result as { error?: unknown } | undefined)?.error")
    expect(src).toContain("if (error) throw replyError(error, failureMessage)")
    const throwIndex = src.indexOf("if (error) throw replyError(error, failureMessage)")
    const removeIndex = src.indexOf("removeRequestLocally(sessionID, id)", throwIndex)
    expect(throwIndex).toBeGreaterThanOrEqual(0)
    expect(removeIndex).toBeGreaterThan(throwIndex)
    expect(src).toContain("function replyError(error: unknown, fallback: string): Error")
  })
})
