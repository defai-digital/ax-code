/** Opt-in live-model acceptance. Runs source AX Code against disposable, synthetic repositories. */
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseJsonRecord } from "../src/util/json-record"
import { assessConsumption, createConsumptionFixture, prompts, scenarios } from "./wiki-consumption-fixture"

const require = createRequire(import.meta.url)
const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const repoRoot = path.resolve(packageRoot, "../..")
const values = (flag: string) =>
  process.argv.flatMap((value, index) => (value === flag ? [process.argv[index + 1]] : []))
const models = values("--model")
const out = values("--out")[0]
const repeats = Number(values("--repeats")[0] ?? 1)
const selected = values("--scenario")
if (
  !models.length ||
  models.some((model) => !model?.includes("/")) ||
  !out ||
  !Number.isInteger(repeats) ||
  repeats < 1 ||
  repeats > 3 ||
  selected.some((value) => !scenarios.includes(value as (typeof scenarios)[number]))
)
  throw new Error(
    "Usage: tsx script/wiki-consumption-eval.ts --model provider/model [--model provider/model] --out NEW_DIRECTORY [--repeats 1..3] [--scenario architecture|stale|omitted-importer|no-profile|measured-profile]",
  )
await mkdir(out, { recursive: false })
const sourceFiles = [
  "src/tool/registry.ts",
  "src/tool/repo_wiki.ts",
  "src/tool/repo_wiki.txt",
  "src/session/prompt/craft.txt",
  "src/agent/prompt/perf.txt",
  "src/agent/prompt/debug.txt",
  "skills/debug-only/SKILL.md",
  "skills/debug-n-fix/SKILL.md",
  "../ax-wiki/src/protocol.ts",
  "../ax-wiki/src/insights.ts",
  "../ax-wiki/src/discovery.ts",
  "src/wiki/coding-insights.ts",
  "script/wiki-consumption-eval.ts",
  "script/wiki-consumption-fixture.ts",
]
const digest = (text: string) => createHash("sha256").update(text).digest("hex")
const sourceHashes = Object.fromEntries(
  await Promise.all(
    sourceFiles.map(async (file) => [file, digest(await readFile(path.join(packageRoot, file), "utf8"))]),
  ),
)
const entry = [
  path.join(repoRoot, "script/node-ffi-runner.mjs"),
  "--import",
  require.resolve("tsx"),
  "--import",
  path.join(repoRoot, "script/solid-loader.mjs"),
  "--conditions=node",
  path.join(packageRoot, "src/index-node-tui.ts"),
]
function run(args: string[], cwd: string, seconds = 240) {
  return new Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>((resolve, reject) => {
    const child = spawn(process.execPath, [...entry, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      env: { ...process.env, AX_CODE_LSP_PREWARM: "0" },
    })
    let stdout = "",
      stderr = "",
      timedOut = false
    const stop = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal)
        else child.kill(signal)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
      }
    }
    const timer = setTimeout(
      () => {
        timedOut = true
        stop("SIGTERM")
      },
      seconds * 1000 + 15_000,
    )
    const kill = setTimeout(
      () => {
        timedOut = true
        stop("SIGKILL")
      },
      seconds * 1000 + 25_000,
    )
    child.stdout.on("data", (data) => {
      stdout += data
      if (stdout.length > 8_000_000) stop("SIGTERM")
    })
    child.stderr.on("data", (data) => {
      stderr += data
      if (stderr.length > 2_000_000) stop("SIGTERM")
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      clearTimeout(kill)
      reject(error)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      clearTimeout(kill)
      resolve({ code, stdout, stderr, timedOut })
    })
  })
}
const results: Array<Record<string, unknown>> = []
// Keep only two model workers live; every scenario owns a different temporary repository.
let modelIndex = 0
async function worker() {
  for (;;) {
    const index = modelIndex++
    const model = models[index]
    if (!model) return
    for (let repeat = 0; repeat < repeats; repeat++)
      for (const scenario of scenarios.filter((scenario) => !selected.length || selected.includes(scenario))) {
        const name = `${index}-${model.split("/").at(-1)}-${repeat + 1}-${scenario}`.replace(/[^a-zA-Z0-9_.-]/g, "_")
        const root = await mkdtemp(path.join(tmpdir(), "wiki-consumption-"))
        try {
          const fixture = await createConsumptionFixture(root, scenario)
          const promptFile = path.resolve(out, `${name}.prompt.txt`)
          await writeFile(
            promptFile,
            prompts[scenario] +
              "\nKeep this small-repository investigation focused. Shell/process execution is unavailable; use source/document reads. Return a concise answer once relevant source and references are checked; do not inspect unrelated runtime/session directories.",
          )
          const result = await run(
            [
              "run",
              "--model",
              model,
              "--agent",
              scenario.includes("profile") ? "perf" : "build",
              "--sandbox",
              "read-only",
              "--timeout",
              "240",
              "--format",
              "json",
              "--disallowed-tools",
              "task,task_parallel,bash,bash_input,bash_output,monitor,verify_project,write,edit,apply_patch,multiedit,webfetch,websearch",
              "--title",
              `Wiki consumption ${scenario}`,
              "--prompt-file",
              promptFile,
            ],
            root,
          )
          await writeFile(path.join(out, `${name}.jsonl`), result.stdout)
          await writeFile(path.join(out, `${name}.stderr`), result.stderr)
          const assessment = assessConsumption(scenario, result.stdout)
          const exported =
            typeof assessment.sessionID === "string"
              ? await run(["session", "export", assessment.sessionID], root, 30)
              : undefined
          const session = exported?.code === 0 ? parseJsonRecord(exported.stdout) : undefined
          const messages = Array.isArray(session?.messages) ? session.messages : []
          const requestEvents = Array.isArray(session?.events)
            ? session.events.flatMap((entry) => {
                const event = parseJsonRecord(parseJsonRecord(entry)?.event)
                return event?.type === "llm.request"
                  ? [{ model: event.model, tools: event.toolNames, requestHash: event.requestHash }]
                  : []
              })
            : []
          const requestedModels = [
            ...new Set(
              messages.flatMap((message) => {
                const info = parseJsonRecord(parseJsonRecord(message)?.info)
                return info?.role === "assistant" &&
                  typeof info.providerID === "string" &&
                  typeof info.modelID === "string"
                  ? [`${info.providerID}/${info.modelID}`]
                  : []
              }),
            ),
          ]
          const unchanged = (
            await Promise.all(
              Object.entries(fixture.sourceHashes).map(
                async ([file, expected]) => digest(await readFile(path.join(root, file), "utf8")) === expected,
              ),
            )
          ).every(Boolean)
          const checks = {
            ...assessment.checks,
            cliSucceeded: result.code === 0 && !result.timedOut,
            requestedModelVerified: requestedModels.length === 1 && requestedModels[0] === model,
            wikiToolAdmitted: requestEvents.some(
              (event) => Array.isArray(event.tools) && event.tools.includes("repo_wiki"),
            ),
            sourcesUnchanged: unchanged,
            manifestUnchanged:
              digest(await readFile(path.join(root, ".ax-wiki/.manifest.json"), "utf8")) === fixture.manifestHash,
            runtimeSourcesUnchanged: (
              await Promise.all(
                Object.entries(sourceHashes).map(
                  async ([file, expected]) => digest(await readFile(path.join(packageRoot, file), "utf8")) === expected,
                ),
              )
            ).every(Boolean),
          }
          const receipt = {
            name,
            model,
            requestedModels,
            requestEvents,
            exportExit: exported?.code,
            scenario,
            repeat: repeat + 1,
            passed: Object.values(checks).every(Boolean),
            checks,
            fixtureHashes: fixture.sourceHashes,
            manifestHash: fixture.manifestHash,
            sourceHashes,
            assessment,
          }
          results.push(receipt)
          await writeFile(path.join(out, `${name}.receipt.json`), JSON.stringify(receipt, null, 2))
          console.log(
            JSON.stringify({
              name,
              passed: receipt.passed,
              failed: Object.entries(checks)
                .filter(([, ok]) => !ok)
                .map(([name]) => name),
            }),
          )
        } finally {
          await rm(root, { recursive: true, force: true })
        }
      }
  }
}
await Promise.all([worker(), worker()])
const report = {
  modelIdentity: "Request metadata only; not upstream weight attestation",
  scope: "Synthetic acceptance samples; no claim of universal behavior or quality uplift",
  passed: results.every((result) => result.passed),
  runs: results.length,
  results,
}
await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2))
if (!report.passed) process.exitCode = 1
