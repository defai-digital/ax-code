import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import z from "zod"
import { Process } from "@/util/process"
import { Hash } from "@/util/hash"
import { parseJsonStrict } from "@/util/json-value"
import { HarnessEval } from "./harness-eval"

export namespace HarnessCapture {
  const Features = z
    .object({
      context_recovery: z.boolean().optional(),
      mcp_tool_discovery: z.boolean().optional(),
      tail_reminders: z.boolean().optional(),
      read_only_recipes: z.boolean().optional(),
    })
    .strict()
  export const Manifest = z
    .object({
      model: z.string().min(3).max(300),
      runtimeRevision: z.string().min(1).max(300),
      command: z.array(z.string().min(1).max(4000)).min(1).max(20).default(["ax-code"]),
      repetitions: z.number().int().min(1).max(50).default(3),
      timeoutMs: z.number().int().min(100).max(600_000).default(120_000),
      arms: z
        .array(
          z
            .object({
              name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
              features: Features.default({}),
              toolProfile: z.enum(["full", "core", "coding"]).optional(),
            })
            .strict(),
        )
        .length(2),
      tasks: z
        .array(
          z
            .object({
              id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
              prompt: z.string().min(1).max(16_000),
              files: z
                .array(z.object({ path: z.string().min(1).max(300), content: z.string().max(64_000) }).strict())
                .min(1)
                .max(100),
              // Trusted operator code, retained outside the coding-agent workspace.
              // process.argv[1] identifies the fixture; no model output becomes argv.
              oracle: z.string().min(1).max(24_000),
            })
            .strict(),
        )
        .min(1)
        .max(100),
    })
    .strict()
  export type Manifest = z.infer<typeof Manifest>

  async function execute(argv: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number, abort?: AbortSignal) {
    abort?.throwIfAborted()
    const child = Process.spawn(argv, {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdout: "ignore",
      stderr: "ignore",
    })
    let outcome: "timeout" | "cancelled" | undefined
    let killing: Promise<void> | undefined
    const stop = (reason: "timeout" | "cancelled") => {
      if (outcome || child.exitCode !== null || child.signalCode !== null) return
      outcome = reason
      killing = Process.killProcessTree(child)
      void killing.catch(() => undefined)
    }
    const onAbort = () => stop("cancelled")
    abort?.addEventListener("abort", onAbort, { once: true })
    if (abort?.aborted) onAbort()
    const timer = setTimeout(() => stop("timeout"), timeoutMs)
    try {
      const code = await child.exited
      await killing
      return { outcome: outcome ?? (code === 0 ? ("completed" as const) : ("failed" as const)), code }
    } finally {
      clearTimeout(timer)
      abort?.removeEventListener("abort", onAbort)
    }
  }

  export async function run(
    input: unknown,
    options: { abort?: AbortSignal; record?: (run: HarnessEval.Run) => Promise<void> } = {},
  ) {
    const manifest = Manifest.parse(input)
    if (
      manifest.arms[0].name === manifest.arms[1].name ||
      new Set(manifest.tasks.map((task) => task.id)).size !== manifest.tasks.length
    )
      throw new Error("Harness arm names and task IDs must be unique")
    if (!manifest.model.includes("/")) throw new Error("Use an explicit provider/model ID")
    for (const task of manifest.tasks) {
      const names = new Set<string>()
      let bytes = 0
      for (const file of task.files) {
        const components = file.path.split("/")
        if (
          components.some(
            (component) => !component || component === "." || component === ".." || component === ".git",
          ) ||
          /[\\:\x00]/.test(file.path) ||
          path.isAbsolute(file.path) ||
          names.has(file.path)
        )
          throw new Error("Fixture paths must be unique relative file paths without Git metadata")
        names.add(file.path)
        bytes += Buffer.byteLength(file.content)
      }
      if (bytes > 1_000_000) throw new Error("Fixture exceeds 1MB")
    }
    const base = z.record(z.string(), z.unknown()).parse(parseJsonStrict(process.env.AX_CODE_CONFIG_CONTENT || "{}"))
    const cohort = Hash.fast(JSON.stringify(manifest))
    const runs: HarnessEval.Run[] = []
    for (const task of manifest.tasks)
      for (let repetition = 0; repetition < manifest.repetitions; repetition++) {
        // Alternate the first arm to reduce systematic warm-cache/order bias.
        const arms = repetition % 2 ? [...manifest.arms].reverse() : manifest.arms
        for (const arm of arms) {
          options.abort?.throwIfAborted()
          const root = await fs.mkdtemp(path.join(os.tmpdir(), "ax-harness-"))
          try {
            for (const file of task.files) {
              const target = path.join(root, file.path)
              await fs.mkdir(path.dirname(target), { recursive: true })
              await fs.writeFile(target, file.content, { flag: "wx" })
            }
            for (const args of [
              ["init", "--quiet"],
              ["add", "--all"],
              [
                "-c",
                "user.name=Harness",
                "-c",
                "user.email=harness@example.invalid",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "--quiet",
                "-m",
                "Initialize isolated harness fixture",
              ],
            ]) {
              await Process.run(["git", ...args], { cwd: root, timeout: 10_000 })
            }
            const env: NodeJS.ProcessEnv = { ...process.env, AX_CODE_ORIGINAL_CWD: root }
            const oracle = [process.execPath, "--input-type=module", "--eval", task.oracle, root]
            const before = await execute(oracle, os.tmpdir(), env, 10_000, options.abort)
            if (before.outcome !== "failed" || before.code !== 1)
              throw new Error(`Oracle must fail with exit 1 before the task is attempted: ${task.id}`)
            const provider = manifest.model.slice(0, manifest.model.indexOf("/"))
            const providers = z.record(z.string(), z.unknown()).parse(base.provider ?? {})
            const providerConfig = z.record(z.string(), z.unknown()).parse(providers[provider] ?? {})
            const providerOptions = z.record(z.string(), z.unknown()).parse(providerConfig.options ?? {})
            env.AX_CODE_CONFIG_CONTENT = JSON.stringify({
              ...base,
              experimental: { ...z.record(z.string(), z.unknown()).parse(base.experimental ?? {}), ...arm.features },
              provider: {
                ...providers,
                [provider]: {
                  ...providerConfig,
                  options: { ...providerOptions, ...(arm.toolProfile ? { toolProfile: arm.toolProfile } : {}) },
                },
              },
            })
            const start = performance.now()
            let outcome: HarnessEval.Run["outcome"] = "failed"
            try {
              outcome = (
                await execute(
                  [
                    ...manifest.command,
                    "run",
                    "--dir",
                    root,
                    "--model",
                    manifest.model,
                    "--sandbox",
                    "workspace-write",
                    "--format",
                    "json",
                    task.prompt,
                  ],
                  root,
                  env,
                  manifest.timeoutMs,
                  options.abort,
                )
              ).outcome
            } catch (error) {
              if (options.abort?.aborted) outcome = "cancelled"
              // Spawn failures are retained as failed samples, not dropped pairs.
            }
            let verified = false
            let verificationMs: number | undefined
            if (outcome === "completed") {
              const verificationStart = performance.now()
              try {
                const verification = await execute(oracle, os.tmpdir(), { ...process.env }, 10_000, options.abort)
                verified = verification.outcome === "completed"
                if (verification.outcome === "cancelled") outcome = "cancelled"
              } catch {
                if (options.abort?.aborted) outcome = "cancelled"
              }
              verificationMs = performance.now() - verificationStart
            }
            const elapsedMs = performance.now() - start
            const run = HarnessEval.Run.parse({
              taskID: task.id,
              arm: arm.name,
              model: manifest.model,
              cohort,
              repetition,
              outcome,
              verified,
              elapsedMs,
              verificationMs,
            })
            runs.push(run)
            await options.record?.(run)
            if (outcome === "cancelled") return { runs, comparison: null, incomplete: true }
          } finally {
            await fs.rm(root, { recursive: true, force: true })
          }
        }
      }
    return {
      runs,
      comparison: HarnessEval.compare(runs, manifest.arms[0].name, manifest.arms[1].name),
      incomplete: false,
    }
  }
}
