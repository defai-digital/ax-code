import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "vitest"

// Regression guards for the session-route bug batch (source-pattern tests,
// matching the render-anti-patterns.test.ts approach):
// - Collapsed Edit diffs must never truncate the raw patch mid-hunk (the
//   diff parser throws and renders "Error parsing diff"); collapse by
//   clipping the rendered preview height instead.
// - The v2 SDK client resolves `{error}` instead of rejecting, so /compact
//   and rollback must check `result.error` — their old `.catch`es were dead
//   code that let failures pass silently (rollback even clobbered the typed
//   prompt on a failed revert).
// - Workflow dialog fetchers must not toast "The operation was aborted."
//   when the user deliberately closed/navigated the dialog (the abort
//   resolves as `{error: AbortError}`).
// - route.initialPrompt (fork pre-fill) must be applied on session→session
//   navigation and consumed once (cleared) so it cannot leak into later
//   navigations.
// - coalesceParts wrappers must be identity-cached so <For> doesn't recreate
//   every row per streamed part, resetting per-row expanded signals.
// - The quality detail pane must fall back to the workflow's current action
//   when readiness transitions change the derived action kind.

const TUI_ROOT = path.join(__dirname, "../../../src/cli/cmd/tui")
const SESSION_INDEX_SRC = path.join(TUI_ROOT, "routes/session/index.tsx")
const FILE_EDITS_SRC = path.join(TUI_ROOT, "routes/session/tool-renderers/file-edits.tsx")
const DISPLAY_COMMANDS_SRC = path.join(TUI_ROOT, "routes/session/display-commands.ts")
const DIALOG_WORKFLOW_SRC = path.join(TUI_ROOT, "routes/session/dialog-workflow.tsx")
const DIALOG_QUALITY_SRC = path.join(TUI_ROOT, "routes/session/dialog-quality.tsx")

describe("collapsed Edit diff rendering", () => {
  test("never truncates the raw patch string (mid-hunk slices break the diff parser)", async () => {
    const fileEdits = await fs.readFile(FILE_EDITS_SRC, "utf8")

    // The old code sliced the patch to 30 lines and appended "…", which cut
    // hunks in half and made every >30-line Edit render "Error parsing diff".
    expect(fileEdits).not.toMatch(/diffLines\(\)\s*\.slice\(0,\s*30\)\s*\.join\("\\n"\)/)
    // The full patch reaches the renderer; the collapse happens by clipping
    // the wrapping box's height, with the "…" indicator outside the diff.
    expect(fileEdits).toContain("diff={rawDiff()}")
    expect(fileEdits).toMatch(/maxHeight=\{collapsed\(\) \? 30 : undefined\}/)
    expect(fileEdits).toMatch(/overflow=\{collapsed\(\) \? "hidden" : undefined\}/)
  })
})

describe("v2 SDK result.error handling", () => {
  test("/compact checks result.error instead of relying on a dead .catch", async () => {
    const displayCommands = await fs.readFile(DISPLAY_COMMANDS_SRC, "utf8")

    const summarizeIndex = displayCommands.indexOf("input.sdk.client.session.summarize({")
    expect(summarizeIndex).toBeGreaterThan(0)
    const summarizeBlock = displayCommands.slice(summarizeIndex, summarizeIndex + 900)
    // The failure toast must come from the resolved `{error}` — a bare
    // `.then(() => dialog.clear())` closes the dialog silently on 4xx/5xx.
    expect(summarizeBlock).toContain("if (result?.error)")
    expect(summarizeBlock).toContain('sdkErrorMessage(result.error, "Failed to summarize session")')
    // dialog.clear() only runs on the success path (after the error check).
    const errorCheckIndex = summarizeBlock.indexOf("if (result?.error)")
    const clearIndex = summarizeBlock.indexOf("dialog.clear()")
    expect(clearIndex).toBeGreaterThan(errorCheckIndex)
  })

  test("rollback checks abort and revert results before overwriting the typed prompt", async () => {
    const sessionIndex = await fs.readFile(SESSION_INDEX_SRC, "utf8")

    const abortIndex = sessionIndex.indexOf("await sdk.client.session.abort({ sessionID: route.sessionID })")
    expect(abortIndex).toBeGreaterThan(0)
    const rollbackBlock = sessionIndex.slice(abortIndex, abortIndex + 1400)
    // Abort guard: a busy-session failure must not fall through to revert.
    expect(rollbackBlock).toContain("if (aborted.error)")
    expect(rollbackBlock).toContain('"Failed to stop the running session before rollback"')
    // Revert: the success path (prompt overwrite + scroll) must be gated on
    // the resolved error — the old .then always ran and clobbered the prompt.
    expect(rollbackBlock).toContain("if (result.error)")
    expect(rollbackBlock).toContain('"Failed to rollback to selected step"')
    const revertErrorIndex = rollbackBlock.indexOf("if (result.error)")
    const promptSetIndex = rollbackBlock.indexOf("prompt.set(promptState(")
    expect(revertErrorIndex).toBeGreaterThan(0)
    expect(promptSetIndex).toBeGreaterThan(revertErrorIndex)
  })

  test("workflow dialog fetchers suppress abort errors from deliberate close/navigation", async () => {
    const dialogWorkflow = await fs.readFile(DIALOG_WORKFLOW_SRC, "utf8")

    expect(dialogWorkflow).toContain("function isAbortError(error: unknown)")
    // Each of the four abortable fetchers (dashboard, run detail, eval
    // summary, artifacts) guards both the resolved `{error}` and the thrown
    // path before toasting.
    const resolvedGuards = dialogWorkflow.match(/if \(signal\.aborted \|\| isAbortError\(result\.error\)\)/g) ?? []
    expect(resolvedGuards.length).toBe(4)
    const thrownGuards = dialogWorkflow.match(/if \(signal\.aborted \|\| isAbortError\(error\)\)/g) ?? []
    expect(thrownGuards.length).toBe(4)
  })
})

describe("fork pre-filled prompt on session navigation", () => {
  test("route.initialPrompt is applied on sessionID change and consumed once", async () => {
    const sessionIndex = await fs.readFile(SESSION_INDEX_SRC, "utf8")

    // The Prompt ref callback only runs on first mount; session→session
    // navigation (fork target already in the sync store) needs an effect.
    const effectIndex = sessionIndex.indexOf("const initial = route.initialPrompt")
    expect(effectIndex).toBeGreaterThan(0)
    const effectBlock = sessionIndex.slice(effectIndex, effectIndex + 600)
    expect(effectBlock).toContain("prompt.set(initial)")
    // Consume-once: clearing prevents the stale prompt from leaking into
    // later navigations (route.navigate merges shallowly).
    expect(effectBlock).toContain('navigate({ type: "session", sessionID, initialPrompt: undefined })')
    // The first-mount ref-callback path stays intact.
    expect(sessionIndex).toContain("if (route.initialPrompt) {")
    expect(sessionIndex).toContain("r.set(route.initialPrompt)")
  })
})

describe("streaming tool-output fold stability", () => {
  test("display-part wrappers are identity-cached so expanded rows survive streamed updates", async () => {
    const sessionIndex = await fs.readFile(SESSION_INDEX_SRC, "utf8")

    // A bare createMemo(() => coalesceParts(...)) fabricates new wrappers
    // each run; <For> keys by identity, so every streamed part recreated all
    // rows and reset their per-row expanded signals.
    expect(sessionIndex).not.toMatch(/createMemo\(\(\) => coalesceParts\(props\.parts\)\)/)
    expect(sessionIndex).toContain("displayPartCache")
    expect(sessionIndex).toContain("function sameDisplayPart(")
    // Cache keys distinguish singles (part.id) from coalesced runs (first
    // callID) so the two kinds cannot collide.
    expect(sessionIndex).toContain('`single:${entry.part.id}`')
    expect(sessionIndex).toContain("`coalesced:${entry.key}`")
  })
})

describe("quality detail pane action lookup", () => {
  test("falls back to the workflow's current action when the derived kind changes", async () => {
    const dialogQuality = await fs.readFile(DIALOG_QUALITY_SRC, "utf8")

    // Readiness transitions change the single derived action kind per
    // workflow; the creation-time `kind` prop then stops matching and the
    // pane wedged into "Quality action unavailable" even though refresh
    // toasted success.
    const memoIndex = dialogQuality.indexOf("findSessionQualityAction({")
    expect(memoIndex).toBeGreaterThan(0)
    const memoBlock = dialogQuality.slice(memoIndex, memoIndex + 700)
    expect(memoBlock).toContain("??")
    expect(memoBlock).toContain(
      "sessionQualityActions({ sessionID: props.sessionID, quality }).find((a) => a.workflow === props.workflow)",
    )
  })
})
