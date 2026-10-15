import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"

// PermissionChoicePrompt preselects the FIRST key of its options object, so
// the first listed option is what a reflexive Enter submits. Persistent-grant
// stages must therefore list the safe option (cancel) first and mark the
// granting option as the danger option. Source-text guards, matching
// permission-idle-once.test.ts (the prompt needs native FFI to render).
const SRC = path.join(import.meta.dirname, "../../../src/cli/tui/routes/session/permission.tsx")

function stageBlock(src: string, stage: string): string {
  const start = src.indexOf(`<Match when={store.stage === "${stage}"}>`)
  expect(start, `stage "${stage}" not found`).toBeGreaterThanOrEqual(0)
  const end = src.indexOf("<Match when={store.stage ===", start + 1)
  expect(end, `no sibling stage after "${stage}"`).toBeGreaterThan(start)
  return src.slice(start, end)
}

describe("permission persistent-grant safe default", () => {
  test("the always stage lists cancel before confirm and marks confirm as dangerous", async () => {
    const src = await fs.readFile(SRC, "utf8")
    const block = stageBlock(src, "always")

    // Cancel first: Enter on the preselected option must back out instead of
    // persisting an "always allow" rule.
    expect(block).toContain('options={{ cancel: t("common.cancel"), confirm: t("common.confirm") }}')
    expect(block).not.toContain('options={{ confirm: t("common.confirm"), cancel: t("common.cancel") }}')
    expect(block).toContain('dangerOption="confirm"')
  })

  test("the webmcp-allowlist stage lists cancel before confirm and marks confirm as dangerous", async () => {
    const src = await fs.readFile(SRC, "utf8")
    const block = stageBlock(src, "webmcp-allowlist")

    expect(block).toContain('options={{ cancel: t("common.cancel"), confirm: "Add and allow" }}')
    expect(block).toContain('dangerOption="confirm"')
  })
})
