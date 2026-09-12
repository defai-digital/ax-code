import { expect, test } from "vitest"
import { canConfirmPersistentPermission, canPersistPermission } from "../../src/permission/interaction"

const request = { id: "per_first", permission: "bash", metadata: {}, always: ["git status"] }

test.each(["isolation_escalation", "bash_destructive", "ops_approve", "webmcp"])(
  "does not offer persistent approval for %s",
  (permission) => expect(canPersistPermission({ ...request, permission })).toBe(false),
)

test("requires actual patterns and respects per-request interaction metadata", () => {
  expect(canPersistPermission(request)).toBe(true)
  expect(canPersistPermission({ ...request, always: [] })).toBe(false)
  expect(canPersistPermission({ ...request, metadata: { requireInteractive: true } })).toBe(false)
  expect(canPersistPermission({ ...request, metadata: { requireInteractive: false } })).toBe(true)
})

test("confirmation is pinned to the staged request and rechecks current policy", () => {
  expect(canConfirmPersistentPermission(request, request.id)).toBe(true)
  expect(canConfirmPersistentPermission(request, undefined)).toBe(false)
  expect(canConfirmPersistentPermission({ ...request, id: "per_next" }, request.id)).toBe(false)
  expect(canConfirmPersistentPermission({ ...request, metadata: { requireInteractive: true } }, request.id)).toBe(false)
  expect(canConfirmPersistentPermission({ ...request, always: [] }, request.id)).toBe(false)
})
