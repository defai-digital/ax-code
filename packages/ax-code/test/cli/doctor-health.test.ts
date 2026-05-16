import { describe, expect, test } from "bun:test"
import { getRecentLogsChecks, getRunningInstancesCheck } from "../../src/cli/cmd/doctor-health"

describe("doctor running instances", () => {
  test("ignores the current process and read-only doctor commands", async () => {
    const check = await getRunningInstancesCheck({
      currentPid: 100,
      run: async () => ["100 ax-code doctor", "200 ax-code", "300 ax-code --version"].join("\n"),
    })

    expect(check).toEqual({
      name: "Running instances",
      status: "warn",
      detail:
        "1 other ax-code process(es) found — this may block startup or cause port conflicts. PIDs: 200. Run: killall ax-code",
    })
  })

  test("reports clean state when no other instances remain", async () => {
    const check = await getRunningInstancesCheck({
      currentPid: 100,
      run: async () => "100 ax-code doctor\n",
    })

    expect(check).toEqual({
      name: "Running instances",
      status: "ok",
      detail: "No other ax-code processes",
    })
  })
})

describe("doctor recent logs", () => {
  test("skips stale historical logs older than 24 hours", async () => {
    const checks = await getRecentLogsChecks({
      logDir: "/tmp/logs",
      now: 2 * 24 * 60 * 60 * 1000,
      readdir: async () => ["old.json.log"],
      stat: async () => ({ mtimeMs: 1 }),
      readFile: async () => "ERROR old failure",
    })

    expect(checks).toEqual([
      {
        name: "Recent logs",
        status: "ok",
        detail: "No log files modified in the last 24h — skipped historical errors",
      },
    ])
  })

  test("reports recent errors from the newest time-bounded logs", async () => {
    const files = {
      "/tmp/logs/new.json.log": "INFO boot\nERROR newest issue\nWARN caution",
      "/tmp/logs/older.log": "ERROR older issue",
    }
    const stats = {
      "/tmp/logs/new.json.log": { mtimeMs: 10_000 },
      "/tmp/logs/older.log": { mtimeMs: 9_000 },
    }

    const checks = await getRecentLogsChecks({
      logDir: "/tmp/logs",
      now: 12_000,
      readdir: async () => Object.keys(files).map((file) => file.split("/").at(-1)!),
      stat: async (target) => stats[target as keyof typeof stats],
      readFile: async (target) => files[target as keyof typeof files],
    })

    expect(checks[0]).toEqual({
      name: "Recent logs",
      status: "ok",
      detail: "2 file(s) checked from the last 24h — 2 errors, 1 warnings",
    })
    expect(checks[1]).toEqual({
      name: "Recent errors",
      status: "warn",
      detail: "ERROR newest issue",
    })
  })
})
