import { existsSync, readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import {
  createDesktopBetaReadinessReport,
  type DesktopBetaReadinessCheck,
  type DesktopBetaReadinessReport,
} from "./beta-readiness"
import { resolveDesktopPackagingCliPath } from "./paths"

export type DesktopBetaEvidenceCheckName =
  | "release-readiness"
  | "qa-beta"
  | "qa-live-sidecar"
  | "qa-live-attach"
  | "renderer-smoke"
  | "packaged-smoke"
  | "command-evidence"

export type DesktopBetaEvidenceCheck = DesktopBetaReadinessCheck & {
  name: DesktopBetaEvidenceCheckName
  path?: string
}

export type DesktopBetaEvidenceCommand = {
  name: string
  command?: string
  status: "passed" | "failed" | "skipped"
  reason?: string
  exitCode?: number
  durationMs?: number
  outputPath?: string
  stdoutPath?: string
  stderrPath?: string
}

export const DESKTOP_BETA_REQUIRED_COMMANDS = [
  "app:typecheck",
  "app:test",
  "app:test:e2e",
  "app:build",
  "app:perf:smoke",
  "app:qa:beta",
  "app:qa:live:sidecar",
  "app:qa:live:attach",
  "desktop:typecheck",
  "desktop:test",
  "desktop:build",
  "desktop:smoke:packaged",
  "desktop:smoke:renderer",
  "desktop:package:mac",
  "repo:check:structure",
] as const

export type DesktopBetaEvidenceBundle = {
  generatedAt: string
  ready: boolean
  strict: boolean
  betaReadiness: DesktopBetaReadinessReport
  checks: Record<DesktopBetaEvidenceCheckName, DesktopBetaEvidenceCheck>
  commands: DesktopBetaEvidenceCommand[]
}

export type DesktopBetaEvidenceOptions = {
  resourcesPath?: string
  macBundlePath?: string
  qaBetaPath?: string
  qaLiveSidecarPath?: string
  qaLiveAttachPath?: string
  rendererSmokePath?: string
  packagedSmokePath?: string
  commandEvidencePath?: string
  updateManifestPath?: string
  releaseArchivePath?: string
  requireLiveQa?: boolean
  requireQaBeta?: boolean
  requireRendererSmoke?: boolean
  requirePackagedSmoke?: boolean
  requireCommandEvidence?: boolean
  requireReleasePipeline?: boolean
  requireRepresentativeLiveQa?: boolean
  strict?: boolean
}

type CommandEvidenceFile = {
  commands?: unknown
  checks?: unknown
}

export function createDesktopBetaEvidenceBundle(options: DesktopBetaEvidenceOptions = {}): DesktopBetaEvidenceBundle {
  const strict = options.strict === true
  const resourcesPath =
    options.resourcesPath ??
    (options.macBundlePath ? path.join(options.macBundlePath, "Contents/Resources") : undefined)
  const betaReadiness = createDesktopBetaReadinessReport({
    resourcesPath,
    qaLiveSidecarPath: options.qaLiveSidecarPath,
    qaLiveAttachPath: options.qaLiveAttachPath,
    requireLiveQa: options.requireLiveQa === true || strict,
    requireRepresentativeLiveQa: options.requireRepresentativeLiveQa === true,
    requireReleasePipeline: options.requireReleasePipeline === true,
    updateManifestPath: options.updateManifestPath,
    releaseArchivePath: options.releaseArchivePath,
  })
  const commands = readCommandEvidence(options.commandEvidencePath)
  const checks: Record<DesktopBetaEvidenceCheckName, DesktopBetaEvidenceCheck> = {
    "release-readiness": checkReleaseReadiness(betaReadiness),
    "qa-beta": checkJsonEvidence({
      name: "qa-beta",
      file: options.qaBetaPath,
      required: options.requireQaBeta === true || strict,
      validate: validateBetaQaEvidence,
    }),
    "qa-live-sidecar": {
      name: "qa-live-sidecar",
      path: options.qaLiveSidecarPath,
      ...betaReadiness.checks.liveSidecarQa,
    },
    "qa-live-attach": {
      name: "qa-live-attach",
      path: options.qaLiveAttachPath,
      ...betaReadiness.checks.liveAttachQa,
    },
    "renderer-smoke": checkJsonEvidence({
      name: "renderer-smoke",
      file: options.rendererSmokePath,
      required: options.requireRendererSmoke === true || strict,
      validate: validateRendererSmokeEvidence,
    }),
    "packaged-smoke": checkJsonEvidence({
      name: "packaged-smoke",
      file: options.packagedSmokePath,
      required: options.requirePackagedSmoke === true || strict,
      validate: validatePackagedSmokeEvidence,
    }),
    "command-evidence": checkCommandEvidence(commands, {
      path: options.commandEvidencePath,
      required: options.requireCommandEvidence === true || strict,
      expectedOutputPaths: {
        "app:qa:beta": options.qaBetaPath,
        "app:qa:live:sidecar": options.qaLiveSidecarPath,
        "app:qa:live:attach": options.qaLiveAttachPath,
        "desktop:smoke:renderer": options.rendererSmokePath,
        "desktop:smoke:packaged": options.packagedSmokePath,
      },
    }),
  }
  const ready = Object.values(checks).every((check) => check.status !== "failed")
  return {
    generatedAt: new Date().toISOString(),
    ready,
    strict,
    betaReadiness,
    checks,
    commands,
  }
}

function checkReleaseReadiness(betaReadiness: DesktopBetaReadinessReport): DesktopBetaEvidenceCheck {
  const checks = Object.values(betaReadiness.checks)
  const failed = checks.filter((check) => check.status === "failed")
  return {
    name: "release-readiness",
    status: failed.length > 0 ? "failed" : "passed",
    reason: failedReasons(failed),
  }
}

function readCommandEvidence(file: string | undefined): DesktopBetaEvidenceCommand[] {
  if (!file || !existsSync(file)) return []
  const record = readRecord(JSON.parse(readFileSync(file, "utf8")) as unknown) as CommandEvidenceFile
  const values = Array.isArray(record.commands) ? record.commands : Array.isArray(record.checks) ? record.checks : []
  return values
    .map(normalizeCommandEvidence)
    .filter((command): command is DesktopBetaEvidenceCommand => Boolean(command))
}

function normalizeCommandEvidence(value: unknown): DesktopBetaEvidenceCommand | undefined {
  const record = readRecord(value)
  const name = readString(record, "name")
  const status = readString(record, "status")
  if (!name || (status !== "passed" && status !== "failed" && status !== "skipped")) return undefined
  const command = readString(record, "command")
  const outputPath = readString(record, "outputPath")
  const stdoutPath = readString(record, "stdoutPath")
  const stderrPath = readString(record, "stderrPath")
  const reason = readString(record, "reason")
  const exitCode = readNumber(record, "exitCode")
  const durationMs = readNumber(record, "durationMs")
  return { name, status, command, outputPath, stdoutPath, stderrPath, reason, exitCode, durationMs }
}

function checkCommandEvidence(
  commands: DesktopBetaEvidenceCommand[],
  options: { path?: string; required: boolean; expectedOutputPaths?: Record<string, string | undefined> },
): DesktopBetaEvidenceCheck {
  if (commands.length === 0) {
    return options.required
      ? { name: "command-evidence", path: options.path, status: "failed", reason: "Command evidence is required." }
      : {
          name: "command-evidence",
          path: options.path,
          status: "warning",
          reason: "Command evidence was not provided.",
        }
  }
  const requiredCommands = DESKTOP_BETA_REQUIRED_COMMANDS
  const byName = new Map(commands.map((command) => [command.name, command]))
  const missing = requiredCommands.filter((name) => !byName.has(name))
  const failed = commands.filter((command) => command.status === "failed").map((command) => command.name)
  const skippedRequired = requiredCommands.filter((name) => byName.get(name)?.status === "skipped")
  const outputMismatches = commandOutputPathMismatches({
    commands: byName,
    commandEvidencePath: options.path,
    expectedOutputPaths: options.expectedOutputPaths ?? {},
  })
  const failureBlockers = failed.map((name) => `failed ${name}`)
  const completenessBlockers = [
    ...missing.map((name) => `missing ${name}`),
    ...skippedRequired.map((name) => `skipped ${name}`),
  ]
  if (failureBlockers.length > 0) {
    return {
      name: "command-evidence",
      path: options.path,
      status: "failed",
      reason: [...failureBlockers, ...completenessBlockers, ...outputMismatches].join("; "),
    }
  }
  if (completenessBlockers.length > 0) {
    return {
      name: "command-evidence",
      path: options.path,
      status: options.required ? "failed" : "warning",
      reason: [...completenessBlockers, ...outputMismatches].join("; "),
    }
  }
  if (outputMismatches.length > 0) {
    return {
      name: "command-evidence",
      path: options.path,
      status: options.required ? "failed" : "warning",
      reason: outputMismatches.join("; "),
    }
  }
  return { name: "command-evidence", path: options.path, status: "passed" }
}

function commandOutputPathMismatches(input: {
  commands: Map<string, DesktopBetaEvidenceCommand>
  commandEvidencePath?: string
  expectedOutputPaths: Record<string, string | undefined>
}) {
  const commandEvidenceDir = input.commandEvidencePath
    ? path.dirname(path.resolve(input.commandEvidencePath))
    : undefined
  const mismatches: string[] = []
  for (const [name, expectedPath] of Object.entries(input.expectedOutputPaths)) {
    if (!expectedPath) continue
    const command = input.commands.get(name)
    if (!command || command.status !== "passed") continue
    const actualPath = command.outputPath ? resolveEvidencePath(command.outputPath, commandEvidenceDir) : undefined
    const normalizedExpected = path.normalize(path.resolve(expectedPath))
    if (!actualPath) {
      mismatches.push(`missing outputPath ${name}`)
      continue
    }
    if (actualPath !== normalizedExpected) {
      mismatches.push(`outputPath mismatch ${name}: expected ${normalizedExpected}, got ${actualPath}`)
    }
  }
  return mismatches
}

function checkJsonEvidence(input: {
  name: DesktopBetaEvidenceCheckName
  file?: string
  required: boolean
  validate: (value: unknown) => string | undefined
}): DesktopBetaEvidenceCheck {
  if (!input.file) {
    return input.required
      ? { name: input.name, status: "failed", reason: `${input.name} evidence is required.` }
      : { name: input.name, status: "warning", reason: `${input.name} evidence was not provided.` }
  }
  if (!existsSync(input.file)) {
    return { name: input.name, path: input.file, status: "failed", reason: `${input.name} file is missing.` }
  }
  let evidence: unknown
  try {
    evidence = JSON.parse(readFileSync(input.file, "utf8")) as unknown
  } catch (error) {
    return {
      name: input.name,
      path: input.file,
      status: "failed",
      reason: `${input.name} evidence is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  const reason = input.validate(evidence)
  return reason
    ? { name: input.name, path: input.file, status: "failed", reason }
    : { name: input.name, path: input.file, status: "passed" }
}

function validateBetaQaEvidence(value: unknown) {
  const record = readRecord(value)
  if (readBoolean(record, "withinBudget") !== true) return "qa:beta did not finish within budget."
  const longSession = readRecord(record["longSession"])
  const reconnect = readRecord(record["reconnect"])
  if (readBoolean(longSession, "withinBudget") !== true) return "qa:beta long-session smoke failed."
  if (readBoolean(reconnect, "withinBudget") !== true) return "qa:beta reconnect smoke failed."
  if (readBoolean(reconnect, "reconnectedSessionPresent") !== true) return "qa:beta did not restore session state."
  if (readBoolean(reconnect, "reconnectedQueuePresent") !== true) return "qa:beta did not restore queue state."
  return undefined
}

function validateRendererSmokeEvidence(value: unknown) {
  const record = readRecord(value)
  const checks = readRecord(record["checks"])
  for (const key of ["electronBrowser", "nonblank", "commandCenter", "actions", "accessibility", "desktopViewports"]) {
    if (readBoolean(checks, key) !== true) return `renderer smoke check failed: ${key}.`
  }
  const viewports = Array.isArray(record["viewports"]) ? record["viewports"] : []
  if (viewports.length === 0) return "renderer smoke did not include viewport evidence."
  for (const viewport of viewports) {
    const viewportChecks = readRecord(readRecord(viewport)["checks"])
    const issues = Array.isArray(viewportChecks["accessibilityIssues"]) ? viewportChecks["accessibilityIssues"] : []
    if (issues.length > 0) return `renderer smoke accessibility issues: ${issues.join("; ")}`
    const keyboard = readRecord(viewportChecks["keyboardFlow"])
    const requiredLabels = readRecord(keyboard["requiredLabels"])
    const missing = Object.entries(requiredLabels)
      .filter(([, present]) => present !== true)
      .map(([label]) => label)
    if (missing.length > 0) return `renderer smoke keyboard flow missing: ${missing.join(", ")}`
    if (readBoolean(viewportChecks, "reconnectBanner") !== true) return "renderer smoke reconnect banner missing."
  }
  return undefined
}

function validatePackagedSmokeEvidence(value: unknown) {
  const checks = readRecord(readRecord(value)["checks"])
  const required = [
    "electronDependency",
    "main",
    "runtimeDependencyClosure",
    "backendLifecycleBridge",
    "diagnosticsLogExport",
    "startupFailureDiagnostics",
    "rendererCrashDiagnostics",
    "loopbackProxyBypass",
    "cleanShutdownLifecycle",
    "rendererIndex",
    "preload",
    "preloadBridgeAllowlist",
    "preloadNoRawIpcExposure",
    "preloadMenuCommandFilter",
    "customProtocol",
    "sandboxedRenderer",
    "macBundle",
    "releaseManifest",
  ]
  const missing = required.filter((key) => readBoolean(checks, key) !== true)
  return missing.length > 0 ? `packaged smoke checks failed: ${missing.join(", ")}` : undefined
}

function failedReasons(checks: DesktopBetaReadinessCheck[]) {
  const reasons = checks
    .filter((check) => check.status === "failed")
    .map((check) => check.reason)
    .filter((reason): reason is string => Boolean(reason))
  return reasons.length > 0 ? reasons.join("; ") : undefined
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === "string" ? value : undefined
}

function readNumber(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function readBoolean(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === "boolean" ? value : undefined
}

function resolveEvidencePath(file: string, baseDir?: string) {
  return path.normalize(path.isAbsolute(file) ? file : path.resolve(baseDir ?? "", file))
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      output: { type: "string" },
      "resources-path": { type: "string" },
      "mac-bundle-path": { type: "string" },
      "qa-beta": { type: "string" },
      "qa-live-sidecar": { type: "string" },
      "qa-live-attach": { type: "string" },
      "renderer-smoke": { type: "string" },
      "packaged-smoke": { type: "string" },
      "command-evidence": { type: "string" },
      "update-manifest-path": { type: "string" },
      "release-archive-path": { type: "string" },
      strict: { type: "boolean", default: false },
      "require-live-qa": { type: "boolean", default: false },
      "require-qa-beta": { type: "boolean", default: false },
      "require-renderer-smoke": { type: "boolean", default: false },
      "require-packaged-smoke": { type: "boolean", default: false },
      "require-command-evidence": { type: "boolean", default: false },
      "require-representative-live-qa": { type: "boolean", default: false },
      "require-release-pipeline": { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  })
  const report = createDesktopBetaEvidenceBundle({
    resourcesPath: resolveDesktopPackagingCliPath(values["resources-path"]),
    macBundlePath: resolveDesktopPackagingCliPath(values["mac-bundle-path"]),
    qaBetaPath: resolveDesktopPackagingCliPath(values["qa-beta"]),
    qaLiveSidecarPath: resolveDesktopPackagingCliPath(values["qa-live-sidecar"]),
    qaLiveAttachPath: resolveDesktopPackagingCliPath(values["qa-live-attach"]),
    rendererSmokePath: resolveDesktopPackagingCliPath(values["renderer-smoke"]),
    packagedSmokePath: resolveDesktopPackagingCliPath(values["packaged-smoke"]),
    commandEvidencePath: resolveDesktopPackagingCliPath(values["command-evidence"]),
    updateManifestPath: resolveDesktopPackagingCliPath(values["update-manifest-path"]),
    releaseArchivePath: resolveDesktopPackagingCliPath(values["release-archive-path"]),
    strict: values.strict,
    requireLiveQa: values["require-live-qa"],
    requireQaBeta: values["require-qa-beta"],
    requireRendererSmoke: values["require-renderer-smoke"],
    requirePackagedSmoke: values["require-packaged-smoke"],
    requireCommandEvidence: values["require-command-evidence"],
    requireRepresentativeLiveQa: values["require-representative-live-qa"],
    requireReleasePipeline: values["require-release-pipeline"],
  })
  const json = JSON.stringify(report, null, 2)
  if (values.output) {
    const output = resolveOutputPath(values.output)
    await mkdir(path.dirname(output), { recursive: true })
    await writeFile(output, `${json}\n`)
  }
  console.log(json)
  if (!report.ready) process.exitCode = 1
}

function resolveOutputPath(value: string) {
  return path.isAbsolute(value) ? value : path.resolve(value)
}
