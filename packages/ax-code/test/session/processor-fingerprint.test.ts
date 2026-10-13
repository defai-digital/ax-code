import { expect, test } from "vitest"
import { SessionProcessor } from "../../src/session/processor"

test("fingerprints inputs under the cap as the canonical JSON itself", () => {
  // Key order is canonicalized: byte-identical to the historical behavior for
  // inputs at or under the length cap.
  expect(SessionProcessor.toolInputFingerprint({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
})

test("distinguishes large inputs that share a prefix past the cap", () => {
  // Two payloads whose canonical JSON shares the first 4,096 characters but
  // differs after it must not collide: a collision here used to raise false
  // doom-loop warnings for large `write` inputs.
  const shared = "x".repeat(5_000)
  const left = SessionProcessor.toolInputFingerprint({ content: shared + "left-tail" })
  const right = SessionProcessor.toolInputFingerprint({ content: shared + "right-tail" })
  expect(left).not.toBe(right)
})

test("identical inputs produce identical fingerprints", () => {
  const value = { content: "y".repeat(6_000), nested: { key: "value" } }
  expect(SessionProcessor.toolInputFingerprint(value)).toBe(
    SessionProcessor.toolInputFingerprint(JSON.parse(JSON.stringify(value))),
  )
})

test("keeps oversized fingerprints bounded", () => {
  // Capped prefix (4,096) + "#" + SHA-256 hex (64) is the maximum length.
  const fingerprint = SessionProcessor.toolInputFingerprint({ content: "z".repeat(1_000_000) })
  expect(fingerprint.length).toBeLessThanOrEqual(4096 + 1 + 64)
})
