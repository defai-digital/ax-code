import { fileURLToPath } from "node:url"
import path from "node:path"

export function requiredCheckFailures(env: Record<string, string | undefined>) {
  const failures: string[] = []
  for (const name of ["PLAN", "CHECKS", "DETERMINISTIC", "RUNTIME", "WINDOWS", "TUI"]) {
    if (env[`CI_${name}`] !== "success") failures.push(`${name}: ${env[`CI_${name}`] || "missing"}`)
  }
  if (!["true", "false"].includes(env.CI_NATIVE_REQUIRED ?? "")) failures.push("Invalid native evidence plan")
  const expected = env.CI_NATIVE_REQUIRED === "true" ? "success" : "skipped"
  if (env.CI_NATIVE !== expected) failures.push(`NATIVE: ${env.CI_NATIVE || "missing"}; expected ${expected}`)
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = requiredCheckFailures(process.env)
  for (const failure of failures) console.error(failure)
  process.exitCode = failures.length ? 1 : 0
}
