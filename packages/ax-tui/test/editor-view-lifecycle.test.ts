import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

test("overlapping editor lifetimes release storage instead of growing the process arena", () => {
  const result = spawnSync(process.execPath, ["--experimental-ffi", "--input-type=module", "-e", `
import assert from "node:assert/strict"
import { EditBuffer, EditorView, resolveRenderLib } from "@defai-digital/ax-tui"
const lib = resolveRenderLib()
function cycle() {
  const first = EditBuffer.create("unicode"), second = EditBuffer.create("unicode")
  const a = EditorView.create(first, 80, 24), b = EditorView.create(second, 80, 24)
  try {
    a.setWrapMode("word"); b.setWrapMode("word")
    first.setText("First 中文"); second.setText("Second cafe\\u0301")
  } finally {
    // Non-LIFO disposal is normal when independent inputs/palettes unmount.
    a.destroy(); first.destroy(); b.destroy(); second.destroy()
  }
}
for (let index = 0; index < 100; index++) cycle()
const baseline = lib.getArenaAllocatedBytes()
for (let index = 0; index < 1000; index++) cycle()
assert.equal(lib.getArenaAllocatedBytes(), baseline, "Disposed editor views retained process-arena storage")
console.log("AX_EDITOR_VIEW_LIFECYCLE_COMPLETE")
`], { encoding: "utf8", timeout: 10000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } })
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(result.stdout).toContain("AX_EDITOR_VIEW_LIFECYCLE_COMPLETE")
})
