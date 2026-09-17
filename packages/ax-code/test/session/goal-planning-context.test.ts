import { expect, test } from "vitest"
import { goalPlanningContext } from "../../src/session/goal-planning-context"

test("forwards POSIX file:// attachment paths regardless of platform", () => {
  const text = goalPlanningContext([], [
    { type: "file", filename: "requirements.md", url: "file:///project/requirements.md" },
  ])
  expect(text).toContain("Attachment source: /project/requirements.md")
  expect(text).not.toContain("content not included")
})

test("forwards Windows drive-letter file:// attachment paths", () => {
  const text = goalPlanningContext([], [
    { type: "file", filename: "requirements.md", url: "file:///C:/project/requirements.md" },
  ])
  expect(text).toMatch(/Attachment source: \/?C:[\\/]project[\\/]requirements\.md/)
  expect(text).not.toContain("content not included")
})

test("does not treat file:// URLs with a remote host as local paths", () => {
  const text = goalPlanningContext([], [
    { type: "file", filename: "secret.env", url: "file://evil.example/etc/passwd" },
  ])
  expect(text).not.toContain("/etc/passwd")
  expect(text).toContain("Attachment: secret.env (content not included; inspect the original before assuming requirements)")
})

test("discloses attachments with no usable local reference", () => {
  const text = goalPlanningContext([], [{ type: "file", filename: "screenshot.png", url: "data:image/png;base64,AA==" }])
  expect(text).toContain("Attachment: screenshot.png (content not included; inspect the original before assuming requirements)")
})
