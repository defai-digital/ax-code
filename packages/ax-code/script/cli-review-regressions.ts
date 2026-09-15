import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { signalBashProcessTree } from "../src/tool/bash-process-cleanup"

export type ReviewRegression = { file: string; fullName: string }
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

export function validateRegression(value: unknown): ReviewRegression | undefined {
  const item = record(value)
  if (typeof item?.file !== "string" || typeof item.fullName !== "string" || !item.fullName.trim()) return undefined
  // Literal repository-relative paths only. Commas would split AX_TEST_FILES.
  if (!/^packages\/ax-code\/test\/cli\/tui\/[A-Za-z0-9_./-]+\.test\.tsx?$/.test(item.file)) return undefined
  if (item.file.split("/").some((part) => part === "." || part === "..")) return undefined
  return { file: item.file, fullName: item.fullName }
}

export function regressionReportFailures(report: unknown, regressions: readonly ReviewRegression[], root: string) {
  const data = record(report)
  if (
    data?.success !== true ||
    typeof data.numTotalTests !== "number" ||
    data.numTotalTests < 1 ||
    data.numFailedTests !== 0 ||
    !Array.isArray(data.testResults)
  )
    return ["Regression run did not report a successful nonempty test suite"]
  const assertions = new Map<string, string[]>()
  for (const item of data.testResults) {
    const file = record(item)
    if (typeof file?.name !== "string" || !Array.isArray(file.assertionResults)) continue
    for (const value of file.assertionResults) {
      const assertion = record(value)
      if (typeof assertion?.fullName === "string") {
        const key = JSON.stringify([path.resolve(file.name), assertion.fullName])
        assertions.set(key, [...(assertions.get(key) ?? []), String(assertion.status)])
      }
    }
  }
  return regressions
    .filter((test) => {
      const states = assertions.get(JSON.stringify([path.resolve(root, test.file), test.fullName]))
      return states?.length !== 1 || states[0] !== "passed"
    })
    .map((test) => `Required regression did not pass: ${test.file} :: ${test.fullName}`)
}

/** Run the referenced assertions now; never trust a caller-supplied test report. */
export async function runReviewRegressions(
  root: string,
  regressions: readonly ReviewRegression[],
  timeoutMs = 120_000,
): Promise<string[]> {
  if (!regressions.length) return []
  const temp = mkdtempSync(path.join(os.tmpdir(), "ax-review-regressions-"))
  try {
    const canonicalRoot = realpathSync(root)
    const files = [...new Set(regressions.map((test) => test.file))]
    const paths = files.map((file) => {
      if (!validateRegression({ file, fullName: "admission" })) throw new Error("Invalid regression path")
      const absolute = path.resolve(canonicalRoot, file)
      if (realpathSync(absolute) !== absolute) throw new Error(`Linked regression path is not admitted: ${file}`)
      return absolute
    })
    const digest = () => paths.map((file) => createHash("sha256").update(readFileSync(file)).digest("hex")).join(":")
    const before = digest()
    const report = path.join(temp, "report.json")
    const require = createRequire(import.meta.url)
    const entry = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs")
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key !== "VITEST" && !key.startsWith("VITEST_")),
    )
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [entry, "run", "--retry", "0", "--maxWorkers", "1", "--reporter", "json", "--outputFile", report],
        {
          cwd: path.join(canonicalRoot, "packages/ax-code"),
          env: { ...env, AX_TEST_FILES: files.map((file) => file.slice("packages/ax-code/".length)).join(",") },
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
        },
      )
      let failure: string | undefined
      let bytes = 0
      const terminate = (reason: string) => {
        failure ??= reason
        if (child.pid) signalBashProcessTree(child.pid, "SIGKILL")
      }
      const timer = setTimeout(() => terminate("Regression test run timed out"), timeoutMs)
      const count = (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > 8 * 1024 * 1024) terminate("Regression output exceeded limit")
      }
      child.stdout.on("data", count)
      child.stderr.on("data", count)
      child.once("error", (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once("close", (code) => {
        clearTimeout(timer)
        if (failure || code !== 0) reject(new Error(failure ?? `Vitest exited ${code}`))
        else resolve()
      })
    })
    if (before !== digest()) return ["Regression source changed during its test run"]
    return regressionReportFailures(JSON.parse(readFileSync(report, "utf8")), regressions, canonicalRoot)
  } catch (error) {
    return [`Regression execution failed: ${error instanceof Error ? error.message : String(error)}`]
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}
