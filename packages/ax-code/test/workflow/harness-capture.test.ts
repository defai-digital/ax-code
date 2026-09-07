import fs from "node:fs/promises"
import path from "node:path"
import { expect, test } from "vitest"
import { HarnessCapture } from "../../src/workflow/harness-capture"
import { tmpdir } from "../fixture/fixture"

const task = {
  id: "arithmetic",
  prompt: "Fix the result file so addition is correct.",
  files: [{ path: "result.txt", content: "wrong" }],
  oracle: `import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict'; assert.equal(fs.readFileSync(path.join(process.argv[1], 'result.txt'), 'utf8'), 'correct');`,
}

test("captures isolated attempts and verifies with trusted oracle code outside the agent workspace", async () => {
  await using tmp = await tmpdir()
  const driver = path.join(tmp.path, "driver.mjs")
  await fs.writeFile(
    driver,
    `import fs from 'node:fs'; import assert from 'node:assert/strict'; import path from 'node:path'; const selected=process.argv[process.argv.indexOf('--dir')+1]; assert.equal(fs.realpathSync(selected),fs.realpathSync(process.cwd())); assert.equal(fs.realpathSync(process.env.AX_CODE_ORIGINAL_CWD),fs.realpathSync(process.cwd())); if (process.env.AX_CODE_CONFIG_CONTENT.includes('"read_only_recipes":true')) fs.writeFileSync('result.txt', 'correct');`,
  )
  const report = await HarnessCapture.run({
    model: "fake/same-model",
    runtimeRevision: "deterministic-test-driver",
    command: [process.execPath, driver],
    repetitions: 2,
    arms: [{ name: "baseline" }, { name: "candidate", features: { read_only_recipes: true } }],
    tasks: [task],
  })
  expect(report.runs).toHaveLength(4)
  expect(report.runs.map((run) => run.arm)).toEqual(["baseline", "candidate", "candidate", "baseline"])
  expect(report.comparison?.baseline.successRate).toBe(0)
  expect(report.comparison?.candidate.successRate).toBe(1)
  expect(report.comparison?.baseline.failures.completed_unverified).toBe(2)
})

test("retains timed-out attempts and rejects traversal or already-passing fixtures", async () => {
  await using tmp = await tmpdir()
  const driver = path.join(tmp.path, "timeout.mjs")
  await fs.writeFile(driver, "setInterval(() => {}, 1000)\n")
  const manifest = {
    model: "fake/same-model",
    runtimeRevision: "test",
    command: [process.execPath, driver],
    timeoutMs: 100,
    repetitions: 1,
    arms: [{ name: "a" }, { name: "b" }],
    tasks: [task],
  }
  const report = await HarnessCapture.run(manifest)
  expect(report.runs.every((run) => run.outcome === "timeout" && !run.verified)).toBe(true)
  await expect(
    HarnessCapture.run({ ...manifest, tasks: [{ ...task, files: [{ path: "../escape", content: "bad" }] }] }),
  ).rejects.toThrow("relative")
  await expect(
    HarnessCapture.run({ ...manifest, tasks: [{ ...task, files: [{ path: "result.txt", content: "correct" }] }] }),
  ).rejects.toThrow("must fail")
})
