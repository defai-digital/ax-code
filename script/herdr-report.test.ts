import { expect, test, vi } from "vitest"
import { mapHookToState, parsePayload, reportState } from "./herdr-report.mjs"

test("maps hook events to herdr states", () => {
  expect(mapHookToState({ event: "Notification", args: { kind: "idle_prompt" } })).toBe("idle")
  expect(mapHookToState({ event: "Notification", args: { kind: "question" } })).toBe("blocked")
  expect(mapHookToState({ event: "Notification", args: { kind: "background_task" } })).toBe("working")
  expect(mapHookToState({ event: "PermissionRequest" })).toBe("blocked")
  expect(mapHookToState({ event: "StopFailure" })).toBe("idle")
  expect(mapHookToState({ event: "Stop" })).toBe("idle")
  expect(mapHookToState({ event: "UserPromptSubmit" })).toBe("working")
})

test("ignores events without a mapped state", () => {
  expect(mapHookToState({ event: "PreToolUse" })).toBeUndefined()
  expect(mapHookToState({ event: "Notification", args: { kind: "unknown" } })).toBeUndefined()
  expect(mapHookToState(null)).toBeUndefined()
  expect(mapHookToState("nope")).toBeUndefined()
})

test("parsePayload prefers stdin, falls back to HOOK_ARGS_JSON, tolerates junk", () => {
  expect(parsePayload('{"event":"Stop"}', {})).toEqual({ event: "Stop" })
  expect(parsePayload("", { HOOK_ARGS_JSON: '{"event":"Stop"}' })).toEqual({ event: "Stop" })
  expect(parsePayload("not json", {})).toBeUndefined()
  expect(parsePayload("", {})).toBeUndefined()
})

test("does not spawn when HERDR_ENV is not 1", () => {
  const spawnSync = vi.fn()
  const reported = reportState({ event: "PermissionRequest", args: { sessionID: "s1" } }, { env: {}, spawnSync })

  expect(reported).toBe(false)
  expect(spawnSync).not.toHaveBeenCalled()
})

test("does not spawn for an unmapped event even when HERDR_ENV is 1", () => {
  const spawnSync = vi.fn()
  const reported = reportState({ event: "PreToolUse" }, { env: { HERDR_ENV: "1" }, spawnSync })

  expect(reported).toBe(false)
  expect(spawnSync).not.toHaveBeenCalled()
})

test("reports the mapped state to herdr when HERDR_ENV is 1", () => {
  const spawnSync = vi.fn().mockReturnValue({ status: 0 })
  const reported = reportState(
    { event: "Notification", args: { kind: "question", sessionID: "s1" } },
    { env: { HERDR_ENV: "1" }, spawnSync },
  )

  expect(reported).toBe(true)
  expect(spawnSync).toHaveBeenCalledWith(
    "herdr",
    ["pane", "report-agent", "--state", "blocked"],
    expect.objectContaining({ stdio: "ignore" }),
  )
})

test("is silent and returns false when herdr is missing or fails", () => {
  const missing = vi.fn().mockReturnValue({ error: new Error("ENOENT"), status: null })
  expect(reportState({ event: "Stop" }, { env: { HERDR_ENV: "1" }, spawnSync: missing })).toBe(false)

  const failed = vi.fn().mockReturnValue({ status: 1 })
  expect(reportState({ event: "Stop" }, { env: { HERDR_ENV: "1" }, spawnSync: failed })).toBe(false)

  const throws = vi.fn().mockImplementation(() => {
    throw new Error("boom")
  })
  expect(reportState({ event: "Stop" }, { env: { HERDR_ENV: "1" }, spawnSync: throws })).toBe(false)
})
