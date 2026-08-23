// Live arm of the model-in-loop (L2) computer-use benchmark: spawns real
// headless `ax-code run` sessions with a vision model against the AG-001..003
// task matrix, judges each by an external post-condition (pbpaste), and writes
// test/computer-e2e/last-report.json.
//
// Run:
//   AX_COMPUTER_AGENT_LIVE=1 AX_COMPUTER_AGENT_MODEL=openai/gpt-4o \
//     pnpm exec vitest run test/computer-e2e/agent-e2e.live.test.ts
//
// Optional: AX_COMPUTER_AGENT_CLI (ax-code binary, default PATH lookup),
// AX_COMPUTER_AGENT_PROVIDER (computer.provider value, default "axnative"),
// AX_COMPUTER_COMMAND (backend server override, forwarded to the run).
//
// The agent drives the real desktop: macOS Screen Recording + Accessibility
// grants must cover the terminal running this test, and TextEdit/Calculator
// state is mutated (documents are left unsaved).

import fs from "node:fs"
import path from "node:path"
import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { tmpdir } from "../fixture/fixture"
import { formatAgentReport, runAgentTask, type AgentCaseResult } from "./harness"
import { agentTaskSet } from "./tasks"

const live = process.env.AX_COMPUTER_AGENT_LIVE === "1"
const model = process.env.AX_COMPUTER_AGENT_MODEL
const cli = process.env.AX_COMPUTER_AGENT_CLI ?? "ax-code"
const provider = process.env.AX_COMPUTER_AGENT_PROVIDER ?? "axnative"

const REPORT_PATH = fileURLToPath(new URL("./last-report.json", import.meta.url))

/** live clipboard probe: pbpaste, undefined when unreadable */
function readClipboard(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("pbpaste", [], { timeout: 5_000 }, (error, stdout) => {
      resolve(error ? undefined : stdout)
    })
  })
}

describe.skipIf(!live || !model)("live agent-level computer-use benchmark", () => {
  // one test per task so results (and retries) are independent; tasks run
  // sequentially inside the file
  for (const task of agentTaskSet()) {
    test(`${task.id}: ${task.name}`, { timeout: 660_000 }, async () => {
      await using tmp = await tmpdir()
      const result = await runAgentTask(task, { model: model!, cli, provider, cwd: tmp.path }, { readClipboard })
      // append each case to the report file incrementally so a mid-matrix
      // abort still leaves the completed results on disk
      const existing = fs.existsSync(REPORT_PATH)
        ? (JSON.parse(fs.readFileSync(REPORT_PATH, "utf8")) as { cases: AgentCaseResult[] })
        : undefined
      const cases = [...(existing?.cases ?? []).filter((c) => c.id !== result.id), result]
      fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
      fs.writeFileSync(REPORT_PATH, JSON.stringify({ model, generatedAt: new Date().toISOString(), cases }, null, 2))
      // eslint-disable-next-line no-console
      console.log("\n" + formatAgentReport(model!, cases))
      // the benchmark records maturity rather than gating on it — but the
      // harness itself must have run: a spawn-level failure is a test failure
      expect(result.detail ?? "").not.toContain("exited")
      expect(result.metrics.steps).toBeGreaterThan(0)
    })
  }
})
