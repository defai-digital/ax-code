import { expect, test } from "vitest"
import { deterministicSuiteAlreadyPassed, parseCheckRunTsv, type CheckRun } from "./ci-release-deterministic-skip"

function shard(index: number, conclusion: string, completedAt: string, status = "completed"): CheckRun {
  return { name: `deterministic (${index}/4)`, status, conclusion, completedAt }
}

function green(completedAt = "2026-09-30T20:12:00Z"): CheckRun[] {
  return [1, 2, 3, 4].map((index) => shard(index, "success", completedAt))
}

test("skips when every latest shard succeeded", () => {
  expect(deterministicSuiteAlreadyPassed(green())).toBe(true)
})

test("runs when a shard is missing or not green", () => {
  expect(deterministicSuiteAlreadyPassed([])).toBe(false)
  expect(deterministicSuiteAlreadyPassed(green().slice(0, 3))).toBe(false)
  const failed = green()
  failed[2] = shard(3, "failure", "2026-09-30T20:12:00Z")
  expect(deterministicSuiteAlreadyPassed(failed)).toBe(false)
  const running = green()
  running[0] = shard(1, "", "2026-09-30T20:12:00Z", "in_progress")
  expect(deterministicSuiteAlreadyPassed(running)).toBe(false)
})

test("uses the latest attempt for each shard", () => {
  const runs = green("2026-09-30T17:30:00Z")
  runs.push(shard(3, "failure", "2026-09-30T20:12:00Z"))
  expect(deterministicSuiteAlreadyPassed(runs)).toBe(false)
  const recovered = green("2026-09-30T17:30:00Z")
  recovered.push(shard(3, "success", "2026-09-30T20:12:00Z"))
  expect(deterministicSuiteAlreadyPassed(recovered)).toBe(true)
})

test("treats a tied failing attempt as not green", () => {
  const runs = green("2026-09-30T20:12:00Z")
  runs.push(shard(4, "cancelled", "2026-09-30T20:12:00Z"))
  expect(deterministicSuiteAlreadyPassed(runs)).toBe(false)
})

test("ignores unrelated checks and blank lines", () => {
  const runs = [
    ...green(),
    { name: "runtime-contract", status: "completed", conclusion: "failure", completedAt: "2026-09-30T20:13:00Z" },
  ]
  expect(deterministicSuiteAlreadyPassed(runs)).toBe(true)
  const parsed = parseCheckRunTsv(
    [
      "deterministic (1/4)\tcompleted\tsuccess\t2026-09-30T20:12:00Z",
      "",
      "not-a-run",
      "deterministic (2/4)\tcompleted\tsuccess\t2026-09-30T20:12:00Z",
      "deterministic (3/4)\tcompleted\tsuccess\t2026-09-30T20:12:00Z",
      "deterministic (4/4)\tcompleted\tsuccess\t2026-09-30T20:12:00Z",
    ].join("\n"),
  )
  expect(deterministicSuiteAlreadyPassed(parsed)).toBe(true)
})
