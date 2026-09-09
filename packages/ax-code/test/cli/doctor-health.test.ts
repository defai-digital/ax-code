import { Process } from "../../src/util/process"
import { describe, expect, test, vi } from "vitest"
import { getRecentLogsChecks, getRunningInstancesCheck } from "../../src/cli/cmd/doctor-health"

describe("doctor running instances", () => {
  test("ignores the current process and read-only doctor commands", async () => {
    const check = await getRunningInstancesCheck({
      platform: "linux",
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
      platform: "linux",
      currentPid: 100,
      run: async () => "100 ax-code doctor\n",
    })

    expect(check).toEqual({
      name: "Running instances",
      status: "ok",
      detail: "No other ax-code processes",
    })
  })

  test("ignores the TUI backend subprocess", async () => {
    const check = await getRunningInstancesCheck({
      platform: "linux",
      currentPid: 100,
      run: async () => "100 ax-code\n200 node /opt/ax-code/index.js tui-backend --stdio\n",
    })

    expect(check).toEqual({
      name: "Running instances",
      status: "ok",
      detail: "No other ax-code processes",
    })
  })

  test("collapses PID-only TUI process chains into one running instance", async () => {
    const parents = new Map([
      [200, 1],
      [201, 200],
      [202, 201],
    ])
    const check = await getRunningInstancesCheck({
      platform: "linux",
      currentPid: 100,
      run: async (command) => {
        if (command[0] === "pgrep") return "100\n200\n201\n202\n"
        const pid = Number(command.at(-1))
        return `${parents.get(pid) ?? 1}\n`
      },
    })

    expect(check).toEqual({
      name: "Running instances",
      status: "warn",
      detail:
        "1 other ax-code process(es) found — this may block startup or cause port conflicts. PIDs: 200. Run: killall ax-code",
    })
  })

  test("reports malformed non-decimal pgrep output as unknown", async () => {
    const check = await getRunningInstancesCheck({
      platform: "linux",
      currentPid: 100,
      run: async () => "0x10 ax-code\n1e3 ax-code\n100 ax-code doctor\n",
    })

    expect(check).toEqual({
      name: "Running instances",
      status: "warn",
      detail: "Unable to enumerate AX Code processes — instance count is unknown",
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
      stat: async (target) => stats[target.replaceAll("\\", "/") as keyof typeof stats],
      readFile: async (target) => files[target.replaceAll("\\", "/") as keyof typeof files],
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

  test("does not treat the packaged TUI entrypoint in an unrelated stack as a TUI error", async () => {
    const line =
      'ERROR 2026-08-20T00:06:55 service=llm error={"error":{"name":"AI_APICallError","message":"Usage limit reached","stack":"AI_APICallError: Usage limit reached\\n at file:///opt/ax-code/index-node-tui.js:258299:18"}} stream error'

    const checks = await getRecentLogsChecks({
      logDir: "/tmp/logs",
      now: 12_000,
      readdir: async () => ["packaged.log"],
      stat: async () => ({ mtimeMs: 10_000 }),
      readFile: async () => line,
    })

    expect(checks[1]).toEqual({
      name: "Recent errors",
      status: "warn",
      detail: line.slice(0, 120),
    })
  })

  test("still fails for errors emitted by a TUI service", async () => {
    const line =
      'ERROR 2026-08-20T00:06:55 service=tui.renderer error=Render failed stack="Error: Render failed\\n at render.js:1:1"'

    const checks = await getRecentLogsChecks({
      logDir: "/tmp/logs",
      now: 12_000,
      readdir: async () => ["tui.log"],
      stat: async () => ({ mtimeMs: 10_000 }),
      readFile: async () => line,
    })

    expect(checks[1]).toEqual({
      name: "TUI errors in logs",
      status: "fail",
      detail: `[tui.log] ${line}`,
    })
  })
})

describe("reported doctor regressions", () => {
  test("enumeration failure is unknown rather than healthy", async () => {
    expect(
      (
        await getRunningInstancesCheck({
          run: async () => {
            throw new Error("spawn pgrep ENOENT")
          },
        })
      )?.status,
    ).toBe("warn")
    expect((await getRunningInstancesCheck({ run: async () => "command timed out" }))?.status).toBe("warn")
  })
  test("counts numeric and named JSON severity without treating provider stacks as renderer failures", async () => {
    const checks = await getRecentLogsChecks({
      logDir: "/logs",
      now: 2000,
      readdir: async () => ["events.json.log"],
      stat: async () => ({ mtimeMs: 1000 }),
      readFile: async () =>
        [
          { level: 50, service: "provider", msg: "Request rejected", err: { stack: "index-node-tui.js" } },
          { level: "error", service: "provider", message: "Access denied" },
          { level: 40, msg: "Slow request" },
          { level: "warning", message: "Delayed" },
        ]
          .map((item) => JSON.stringify(item))
          .join("\n"),
    })
    expect(checks[0].detail).toContain("2 errors, 2 warnings")
    expect(checks.some((check) => check.name === "TUI errors in logs")).toBe(false)
  })
  test("five empty files cannot hide the sixth recent JSON renderer crash", async () => {
    const checks = await getRecentLogsChecks({
      logDir: "/logs",
      now: 2000,
      readdir: async () => ["1.log", "2.log", "3.log", "4.log", "5.log", "6.json.log"],
      stat: async (target) => ({ mtimeMs: 1900 - Number(target.split(/[\\/]/).at(-1)![0]) }),
      readFile: async (target) =>
        target.endsWith("6.json.log") ? '{"level":50,"service":"tui","msg":"renderer crashed"}' : "",
    })
    expect(checks[0].detail).toContain("1 errors")
    expect(checks.some((check) => check.status === "fail")).toBe(true)
  })
  test("unreadable recent logs report incomplete statistics", async () => {
    const checks = await getRecentLogsChecks({
      logDir: "/logs",
      now: 2000,
      readdir: async () => ["error.log"],
      stat: async () => ({ mtimeMs: 1000 }),
      readFile: async () => {
        throw new Error("permission denied")
      },
    })
    expect(checks.some((check) => check.name === "Log access" && check.status === "warn")).toBe(true)
  })
})

test.each([false, true])("paired logs preserve JSON-only and repeated events (json newest=%s)", async (jsonNewest) => {
  const text = "ERROR 2026-09-08T12:00:00 +1ms service=tui renderer crashed"
  const json = JSON.stringify({
    level: 50,
    time: Date.parse("2026-09-08T12:00:00Z"),
    service: "tui",
    msg: "renderer crashed",
  })
  const checks = await getRecentLogsChecks({
    logDir: "/logs",
    now: 2000,
    readdir: async () => ["run.log", "run.json.log"],
    stat: async (file) => ({ mtimeMs: file.endsWith("json.log") === jsonNewest ? 1999 : 1998 }),
    readFile: async (file) =>
      file.endsWith("json.log") ? [json, json, JSON.stringify({ level: 40, msg: "json only" })].join("\n") : text,
  })
  expect(checks[0].detail).toContain("2 errors, 1 warnings")
})

test("Windows enumeration recognizes quoted normalized entrypoints and deduplicates children", async () => {
  const row = (pid: number, parent: number, command: string) => ({
    ProcessId: pid,
    ParentProcessId: parent,
    Name: "node.exe",
    CommandLine: command,
  })
  const check = await getRunningInstancesCheck({
    platform: "win32",
    currentPid: 100,
    run: async (command) => {
      expect(command[0]).toBe("powershell.exe")
      return (
        "\uFEFF" +
        JSON.stringify([
          { ProcessId: 0, ParentProcessId: 0, Name: "System Idle Process", CommandLine: null },
          row(100, 1, "node C:\\Users\\a\\.ax-code\\lib\\index-node-tui.js doctor"),
          row(
            200,
            1,
            '"C:\\Program Files\\node.exe" "C:\\Users\\User Name\\.ax-code\\bin\\..\\lib\\index-node-tui.js"',
          ),
          row(201, 200, "node C:\\Users\\a\\.ax-code\\lib\\index-node-tui.js"),
          row(202, 200, "node C:\\Users\\a\\.ax-code\\lib\\index-node-tui.js tui-backend --stdio"),
          row(300, 1, "node C:\\repo\\ax-code\\node_modules\\other\\index.js"),
          row(400, 1, "node C:\\Users\\a\\.ax-code\\lib\\index-node-tui.js --version"),
        ])
      )
    },
  })
  expect(check?.detail).toContain("1 other ax-code")
  expect(check?.detail).toContain("PIDs: 200.")
})

test.each([
  "not json",
  "command timed out",
  "",
  JSON.stringify([{ ProcessId: 1, ParentProcessId: 0, Name: "node.exe", CommandLine: null }]),
])("invalid Windows enumeration stays unknown: %s", async (raw) => {
  expect((await getRunningInstancesCheck({ platform: "win32", run: async () => raw }))?.status).toBe("warn")
})

test("an empty Windows process list is healthy", async () => {
  expect((await getRunningInstancesCheck({ platform: "win32", run: async () => "[]" }))?.status).toBe("ok")
})

test.each([0, 1, 2, 124])(
  "the real enumeration runner distinguishes no-match from command failure (exit=%s)",
  async (code) => {
    const spy = vi.spyOn(Process, "text").mockResolvedValue({
      code,
      text: "",
      stderr: Buffer.from(code > 1 ? "failed" : ""),
      stdout: Buffer.alloc(0),
    } as Awaited<ReturnType<typeof Process.text>>)
    try {
      const result = await getRunningInstancesCheck({ platform: "linux" })
      expect(result?.status).toBe(code <= 1 ? "ok" : "warn")
    } finally {
      spy.mockRestore()
    }
  },
)

test("Windows node import flags and prompt words do not hide a running instance", async () => {
  const result = await getRunningInstancesCheck({
    platform: "win32",
    currentPid: 100,
    run: async () =>
      JSON.stringify([
        {
          ProcessId: 200,
          ParentProcessId: 1,
          Name: "node.exe",
          CommandLine: 'node --import tsx C:\\repo\\ax-code\\src\\index-node.ts run "diagnose doctor failure"',
        },
        {
          ProcessId: 300,
          ParentProcessId: 1,
          Name: "node.exe",
          CommandLine: 'node C:\\Users\\a\\.ax-code\\lib\\index-node-tui.js --cwd "C:\\Some Project" doctor',
        },
      ]),
  })
  expect(result?.detail).toContain("PIDs: 200.")
})
