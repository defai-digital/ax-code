import { existsSync } from "node:fs"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import {
  createDesktopBetaEvidenceBundle,
  DESKTOP_BETA_REQUIRED_COMMANDS,
  type DesktopBetaEvidenceBundle,
  type DesktopBetaEvidenceCommand,
} from "./beta-evidence"
import { desktopPackagingRepoRoot, resolveDesktopPackagingCliPath } from "./paths"

export { resolveDesktopPackagingCliPath as resolveBetaCollectCliPath } from "./paths"

export type DesktopBetaCollectCommandSpec = {
  name: string
  command: string[]
  outputPath?: string
  skipReason?: string
}

export type DesktopBetaCollectCommandResult = {
  exitCode: number
  stdout?: string
  stderr?: string
}

export type DesktopBetaCollectRunner = (
  command: DesktopBetaCollectCommandSpec,
  context: { repoRoot: string; outputDir: string },
) => Promise<DesktopBetaCollectCommandResult>

export type DesktopBetaCollectOptions = {
  outputDir?: string
  macBundlePath?: string
  qaLiveDirectory?: string
  qaLiveAttachUrl?: string
  qaLiveAttachFromDirectory?: string
  qaLiveAuthHeader?: string
  qaLiveEventWindowMs?: number
  representativeLiveQa?: boolean
  qaLiveMinSessions?: number
  qaLiveMinQueueItems?: number
  qaLiveMinVisibleMessages?: number
  qaLiveMinHiddenMessages?: number
  qaLiveMinAppliedEvents?: number
  qaLiveMinScheduledTasks?: number
  strict?: boolean
  requireLiveQa?: boolean
  requireReleasePipeline?: boolean
  updateManifestPath?: string
  releaseArchivePath?: string
  skipRendererSmoke?: boolean
  runner?: DesktopBetaCollectRunner
}

export type DesktopBetaCollectResult = {
  outputDir: string
  paths: {
    qaBeta: string
    qaLiveSidecar: string
    qaLiveAttach: string
    rendererSmoke: string
    packagedSmoke: string
    commandEvidence: string
    evidenceBundle: string
  }
  commands: DesktopBetaEvidenceCommand[]
  bundle: DesktopBetaEvidenceBundle
}

const DEFAULT_OUTPUT_DIR = "/private/tmp/ax-code-desktop-beta"

export async function runDesktopBetaCollect(
  options: DesktopBetaCollectOptions = {},
): Promise<DesktopBetaCollectResult> {
  const repoRoot = desktopPackagingRepoRoot()
  const outputDir = path.resolve(options.outputDir ?? DEFAULT_OUTPUT_DIR)
  const macBundlePath =
    resolveDesktopPackagingCliPath(options.macBundlePath, repoRoot) ??
    path.join(repoRoot, "packages/desktop/dist/mac/AX Code.app")
  const paths = {
    qaBeta: path.join(outputDir, "qa-beta.json"),
    qaLiveSidecar: path.join(outputDir, "qa-live-sidecar.json"),
    qaLiveAttach: path.join(outputDir, "qa-live-attach.json"),
    rendererSmoke: path.join(outputDir, "renderer-smoke.json"),
    packagedSmoke: path.join(outputDir, "packaged-smoke.json"),
    commandEvidence: path.join(outputDir, "commands.json"),
    evidenceBundle: path.join(outputDir, "evidence-bundle.json"),
  }
  await mkdir(outputDir, { recursive: true })

  const commandSpecs = buildBetaCollectCommandSpecs({
    outputDir,
    paths,
    macBundlePath,
    qaLiveDirectory: resolveDesktopPackagingCliPath(options.qaLiveDirectory, repoRoot),
    qaLiveAttachUrl: options.qaLiveAttachUrl,
    qaLiveAttachFromDirectory:
      resolveDesktopPackagingCliPath(options.qaLiveAttachFromDirectory, repoRoot) ??
      resolveDesktopPackagingCliPath(options.qaLiveDirectory, repoRoot),
    qaLiveAuthHeader: options.qaLiveAuthHeader,
    qaLiveEventWindowMs: options.qaLiveEventWindowMs,
    representativeLiveQa: options.representativeLiveQa === true,
    qaLiveMinSessions: options.qaLiveMinSessions,
    qaLiveMinQueueItems: options.qaLiveMinQueueItems,
    qaLiveMinVisibleMessages: options.qaLiveMinVisibleMessages,
    qaLiveMinHiddenMessages: options.qaLiveMinHiddenMessages,
    qaLiveMinAppliedEvents: options.qaLiveMinAppliedEvents,
    qaLiveMinScheduledTasks: options.qaLiveMinScheduledTasks,
    requireLiveQa: options.requireLiveQa === true || options.strict === true,
    skipRendererSmoke: options.skipRendererSmoke === true,
  })
  const runner = options.runner ?? runShellCommand
  const commands: DesktopBetaEvidenceCommand[] = []
  for (const spec of commandSpecs) {
    commands.push(await runEvidenceCommand({ spec, outputDir, repoRoot, runner }))
  }
  const strict = options.strict === true
  const requireLiveQa = options.requireLiveQa === true
  const requireRendererSmoke = options.skipRendererSmoke !== true
  const updateManifestPath = resolveDesktopPackagingCliPath(options.updateManifestPath, repoRoot)
  const releaseArchivePath = resolveDesktopPackagingCliPath(options.releaseArchivePath, repoRoot)

  await writeFile(paths.commandEvidence, `${JSON.stringify({ commands }, null, 2)}\n`)
  const bundle = createDesktopBetaEvidenceBundle({
    macBundlePath,
    qaBetaPath: paths.qaBeta,
    qaLiveSidecarPath: evidencePath(paths.qaLiveSidecar, strict || requireLiveQa),
    qaLiveAttachPath: evidencePath(paths.qaLiveAttach, strict || requireLiveQa),
    rendererSmokePath: evidencePath(paths.rendererSmoke, strict || requireRendererSmoke),
    packagedSmokePath: paths.packagedSmoke,
    commandEvidencePath: paths.commandEvidence,
    strict,
    requireLiveQa,
    requireQaBeta: true,
    requireRendererSmoke,
    requirePackagedSmoke: true,
    requireCommandEvidence: strict,
    requireRepresentativeLiveQa: options.representativeLiveQa === true,
    requireReleasePipeline: options.requireReleasePipeline === true,
    updateManifestPath,
    releaseArchivePath,
  })
  await writeFile(paths.evidenceBundle, `${JSON.stringify(bundle, null, 2)}\n`)

  return { outputDir, paths, commands, bundle }
}

function buildBetaCollectCommandSpecs(input: {
  outputDir: string
  paths: DesktopBetaCollectResult["paths"]
  macBundlePath: string
  qaLiveDirectory?: string
  qaLiveAttachUrl?: string
  qaLiveAttachFromDirectory?: string
  qaLiveAuthHeader?: string
  qaLiveEventWindowMs?: number
  representativeLiveQa: boolean
  qaLiveMinSessions?: number
  qaLiveMinQueueItems?: number
  qaLiveMinVisibleMessages?: number
  qaLiveMinHiddenMessages?: number
  qaLiveMinAppliedEvents?: number
  qaLiveMinScheduledTasks?: number
  requireLiveQa: boolean
  skipRendererSmoke: boolean
}): DesktopBetaCollectCommandSpec[] {
  const specs: DesktopBetaCollectCommandSpec[] = [
    { name: "app:typecheck", command: ["pnpm", "--dir", "packages/app", "run", "typecheck"] },
    { name: "app:test", command: ["pnpm", "--dir", "packages/app", "run", "test"] },
    { name: "app:test:e2e", command: ["pnpm", "--dir", "packages/app", "run", "test:e2e"] },
    { name: "app:build", command: ["pnpm", "--dir", "packages/app", "run", "build"] },
    { name: "app:perf:smoke", command: ["pnpm", "--dir", "packages/app", "run", "perf:smoke"] },
    {
      name: "app:qa:beta",
      command: ["pnpm", "--dir", "packages/app", "run", "qa:beta", "--", "--output", input.paths.qaBeta],
      outputPath: input.paths.qaBeta,
    },
    { name: "desktop:typecheck", command: ["pnpm", "--dir", "packages/desktop", "run", "typecheck"] },
    { name: "desktop:test", command: ["pnpm", "--dir", "packages/desktop", "run", "test"] },
    { name: "desktop:build", command: ["pnpm", "--dir", "packages/desktop", "run", "build"] },
    {
      name: "desktop:package:mac",
      command: [
        "pnpm",
        "--dir",
        "packages/desktop",
        "run",
        "package:mac",
        "--",
        "--bundle-root",
        path.dirname(input.macBundlePath),
      ],
    },
    {
      name: "desktop:smoke:packaged",
      command: [
        "pnpm",
        "--dir",
        "packages/desktop",
        "run",
        "smoke:packaged",
        "--",
        "--output",
        input.paths.packagedSmoke,
        "--mac-bundle-path",
        input.macBundlePath,
      ],
      outputPath: input.paths.packagedSmoke,
    },
    input.skipRendererSmoke
      ? {
          name: "desktop:smoke:renderer",
          command: ["pnpm", "--dir", "packages/desktop", "run", "smoke:renderer"],
          outputPath: input.paths.rendererSmoke,
          skipReason: "Renderer smoke was skipped by --skip-renderer-smoke.",
        }
      : {
          name: "desktop:smoke:renderer",
          command: [
            "pnpm",
            "--dir",
            "packages/desktop",
            "run",
            "smoke:renderer",
            "--",
            "--output",
            input.paths.rendererSmoke,
          ],
          outputPath: input.paths.rendererSmoke,
        },
    { name: "repo:check:structure", command: ["pnpm", "run", "check:structure"] },
  ]
  specs.push(
    input.qaLiveDirectory
      ? {
          name: "app:qa:live:sidecar",
          command: liveQaCommand({
            outputPath: input.paths.qaLiveSidecar,
            directory: input.qaLiveDirectory,
            eventWindowMs: input.qaLiveEventWindowMs,
            representative: input.representativeLiveQa,
            minSessions: input.qaLiveMinSessions,
            minQueueItems: input.qaLiveMinQueueItems,
            minVisibleMessages: input.qaLiveMinVisibleMessages,
            minHiddenMessages: input.qaLiveMinHiddenMessages,
            minAppliedEvents: input.qaLiveMinAppliedEvents,
            minScheduledTasks: input.qaLiveMinScheduledTasks,
          }),
          outputPath: input.paths.qaLiveSidecar,
        }
      : {
          name: "app:qa:live:sidecar",
          command: [],
          outputPath: input.paths.qaLiveSidecar,
          skipReason: input.requireLiveQa
            ? "Live sidecar QA was required but --qa-live-directory was not provided."
            : "Live sidecar QA was not configured.",
        },
  )
  specs.push(
    input.qaLiveAttachUrl
      ? {
          name: "app:qa:live:attach",
          command: liveQaCommand({
            outputPath: input.paths.qaLiveAttach,
            attachUrl: input.qaLiveAttachUrl,
            authHeader: input.qaLiveAuthHeader,
            eventWindowMs: input.qaLiveEventWindowMs,
            representative: input.representativeLiveQa,
            minSessions: input.qaLiveMinSessions,
            minQueueItems: input.qaLiveMinQueueItems,
            minVisibleMessages: input.qaLiveMinVisibleMessages,
            minHiddenMessages: input.qaLiveMinHiddenMessages,
            minAppliedEvents: input.qaLiveMinAppliedEvents,
            minScheduledTasks: input.qaLiveMinScheduledTasks,
          }),
          outputPath: input.paths.qaLiveAttach,
        }
      : input.qaLiveAttachFromDirectory
        ? {
            name: "app:qa:live:attach",
            command: liveQaCommand({
              outputPath: input.paths.qaLiveAttach,
              attachFromDirectory: input.qaLiveAttachFromDirectory,
              eventWindowMs: input.qaLiveEventWindowMs,
              representative: input.representativeLiveQa,
              minSessions: input.qaLiveMinSessions,
              minQueueItems: input.qaLiveMinQueueItems,
              minVisibleMessages: input.qaLiveMinVisibleMessages,
              minHiddenMessages: input.qaLiveMinHiddenMessages,
              minAppliedEvents: input.qaLiveMinAppliedEvents,
              minScheduledTasks: input.qaLiveMinScheduledTasks,
            }),
            outputPath: input.paths.qaLiveAttach,
          }
        : {
            name: "app:qa:live:attach",
            command: [],
            outputPath: input.paths.qaLiveAttach,
            skipReason: input.requireLiveQa
              ? "Live attach QA was required but --qa-live-attach-url was not provided."
              : "Live attach QA was not configured.",
          },
  )
  const names = new Set(specs.map((spec) => spec.name))
  for (const required of DESKTOP_BETA_REQUIRED_COMMANDS) {
    if (!names.has(required)) throw new Error(`Beta collect is missing required command: ${required}`)
  }
  return specs
}

function liveQaCommand(input: {
  outputPath: string
  directory?: string
  attachUrl?: string
  attachFromDirectory?: string
  authHeader?: string
  eventWindowMs?: number
  representative?: boolean
  minSessions?: number
  minQueueItems?: number
  minVisibleMessages?: number
  minHiddenMessages?: number
  minAppliedEvents?: number
  minScheduledTasks?: number
}) {
  const command = ["pnpm", "--dir", "packages/app", "run", "qa:live", "--"]
  if (input.directory) command.push("--directory", input.directory)
  if (input.attachUrl) command.push("--attach-url", input.attachUrl)
  if (input.attachFromDirectory) command.push("--attach-from-directory", input.attachFromDirectory)
  if (input.authHeader) command.push("--auth-header", input.authHeader)
  if (input.eventWindowMs !== undefined) command.push("--event-window-ms", String(input.eventWindowMs))
  if (input.representative) command.push("--representative")
  if (input.minSessions !== undefined) command.push("--min-sessions", String(input.minSessions))
  if (input.minQueueItems !== undefined) command.push("--min-queue-items", String(input.minQueueItems))
  if (input.minVisibleMessages !== undefined) command.push("--min-visible-messages", String(input.minVisibleMessages))
  if (input.minHiddenMessages !== undefined) command.push("--min-hidden-messages", String(input.minHiddenMessages))
  if (input.minAppliedEvents !== undefined) command.push("--min-applied-events", String(input.minAppliedEvents))
  if (input.minScheduledTasks !== undefined) command.push("--min-scheduled-tasks", String(input.minScheduledTasks))
  command.push("--output", input.outputPath)
  return command
}

async function runEvidenceCommand(input: {
  spec: DesktopBetaCollectCommandSpec
  outputDir: string
  repoRoot: string
  runner: DesktopBetaCollectRunner
}): Promise<DesktopBetaEvidenceCommand> {
  const { spec } = input
  const command = evidenceCommandString(spec.command)
  if (spec.skipReason) {
    return {
      name: spec.name,
      command,
      status: "skipped",
      reason: spec.skipReason,
      outputPath: spec.outputPath,
    }
  }
  if (spec.outputPath) await rm(spec.outputPath, { force: true })
  const started = performance.now()
  const result = await input.runner(spec, { outputDir: input.outputDir, repoRoot: input.repoRoot })
  const durationMs = Math.round(performance.now() - started)
  const stdoutPath = path.join(input.outputDir, `${sanitizeCommandName(spec.name)}.stdout.log`)
  const stderrPath = path.join(input.outputDir, `${sanitizeCommandName(spec.name)}.stderr.log`)
  if (result.stdout) await writeFile(stdoutPath, result.stdout)
  if (result.stderr) await writeFile(stderrPath, result.stderr)
  return {
    name: spec.name,
    command,
    status: result.exitCode === 0 ? "passed" : "failed",
    exitCode: result.exitCode,
    durationMs,
    outputPath: spec.outputPath,
    stdoutPath: result.stdout ? stdoutPath : undefined,
    stderrPath: result.stderr ? stderrPath : undefined,
  }
}

async function runShellCommand(
  spec: DesktopBetaCollectCommandSpec,
  context: { repoRoot: string; outputDir: string },
): Promise<DesktopBetaCollectCommandResult> {
  const child = Bun.spawn(spec.command, {
    cwd: context.repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    child.stdout ? new Response(child.stdout).text() : Promise.resolve(""),
    child.stderr ? new Response(child.stderr).text() : Promise.resolve(""),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}

function sanitizeCommandName(name: string) {
  return name.replace(/[^a-z0-9_.-]+/gi, "-")
}

export function evidenceCommandString(command: readonly string[]) {
  const redacted: string[] = []
  let redactNext = false
  for (const part of command) {
    if (redactNext) {
      redacted.push("<redacted>")
      redactNext = false
      continue
    }
    redacted.push(part)
    if (part === "--auth-header") redactNext = true
  }
  return redacted.join(" ")
}

function evidencePath(file: string, required: boolean) {
  return required || existsSync(file) ? file : undefined
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "output-dir": { type: "string" },
      "mac-bundle-path": { type: "string" },
      "qa-live-directory": { type: "string" },
      "qa-live-attach-url": { type: "string" },
      "qa-live-attach-from-directory": { type: "string" },
      "qa-live-auth-header": { type: "string" },
      "qa-live-event-window-ms": { type: "string" },
      "representative-live-qa": { type: "boolean", default: false },
      "qa-live-min-sessions": { type: "string" },
      "qa-live-min-queue-items": { type: "string" },
      "qa-live-min-visible-messages": { type: "string" },
      "qa-live-min-hidden-messages": { type: "string" },
      "qa-live-min-applied-events": { type: "string" },
      "qa-live-min-scheduled-tasks": { type: "string" },
      strict: { type: "boolean", default: false },
      "require-live-qa": { type: "boolean", default: false },
      "require-release-pipeline": { type: "boolean", default: false },
      "update-manifest-path": { type: "string" },
      "release-archive-path": { type: "string" },
      "skip-renderer-smoke": { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  })
  const result = await runDesktopBetaCollect({
    outputDir: values["output-dir"],
    macBundlePath: values["mac-bundle-path"],
    qaLiveDirectory: values["qa-live-directory"],
    qaLiveAttachUrl: values["qa-live-attach-url"],
    qaLiveAttachFromDirectory: values["qa-live-attach-from-directory"],
    qaLiveAuthHeader: values["qa-live-auth-header"],
    qaLiveEventWindowMs: values["qa-live-event-window-ms"] ? Number(values["qa-live-event-window-ms"]) : undefined,
    representativeLiveQa: values["representative-live-qa"],
    qaLiveMinSessions: values["qa-live-min-sessions"] ? Number(values["qa-live-min-sessions"]) : undefined,
    qaLiveMinQueueItems: values["qa-live-min-queue-items"] ? Number(values["qa-live-min-queue-items"]) : undefined,
    qaLiveMinVisibleMessages: values["qa-live-min-visible-messages"]
      ? Number(values["qa-live-min-visible-messages"])
      : undefined,
    qaLiveMinHiddenMessages: values["qa-live-min-hidden-messages"]
      ? Number(values["qa-live-min-hidden-messages"])
      : undefined,
    qaLiveMinAppliedEvents: values["qa-live-min-applied-events"]
      ? Number(values["qa-live-min-applied-events"])
      : undefined,
    qaLiveMinScheduledTasks: values["qa-live-min-scheduled-tasks"]
      ? Number(values["qa-live-min-scheduled-tasks"])
      : undefined,
    strict: values.strict,
    requireLiveQa: values["require-live-qa"],
    requireReleasePipeline: values["require-release-pipeline"],
    updateManifestPath: values["update-manifest-path"],
    releaseArchivePath: values["release-archive-path"],
    skipRendererSmoke: values["skip-renderer-smoke"],
  })
  console.log(JSON.stringify(result.bundle, null, 2))
  if (!result.bundle.ready) process.exitCode = 1
}
