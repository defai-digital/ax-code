import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  TUI_RENDERER_CONTRACT_VERSION,
  type TuiRendererContractRequirement,
} from "../src/cli/cmd/tui/renderer-contract"
import type { TuiRendererContractReport, TuiRendererContractStatus } from "../src/cli/cmd/tui/renderer-parity"
import { assertTuiBenchmarkOutputPath } from "./tui-benchmark"

const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)))

type ContractGroupID =
  | "native-core"
  | "native-phase6"
  | "focus-manager"
  | "prompt-editor"
  | "debug-diagnostics"
  | "renderer-contract"

type ContractVerificationGroup = {
  id: ContractGroupID
  files: string[]
}

type ContractRequirementEvidence = {
  groups?: ContractGroupID[]
  evidence: string[]
}

type ContractVerificationResult = {
  ok: boolean
  output?: string
}

const CONTRACT_GROUPS: ContractVerificationGroup[] = [
  {
    id: "native-core",
    files: ["test/cli/tui/native-vertical-slice.test.ts"],
  },
  {
    id: "native-phase6",
    files: ["test/cli/tui/native-phase6.test.ts"],
  },
  {
    id: "focus-manager",
    files: ["test/cli/tui/focus-manager.test.ts"],
  },
  {
    id: "prompt-editor",
    files: ["test/cli/tui/prompt-editor.test.ts", "test/cli/tui/prompt-view-model.test.ts"],
  },
  {
    id: "debug-diagnostics",
    files: ["test/debug/diagnostic-log.test.ts", "test/cli/tui/native-diagnostics.test.ts"],
  },
  {
    id: "renderer-contract",
    files: ["test/cli/tui/renderer-contract.test.ts"],
  },
]

const CONTRACT_REQUIREMENTS: Record<string, ContractRequirementEvidence> = {
  "frame.lifecycle": {
    groups: ["native-core"],
    evidence: [
      "benchmark:startup.first-frame",
      "benchmark:terminal.resize-stability",
      "test:test/cli/tui/native-vertical-slice.test.ts",
    ],
  },
  "input.keyboard-mouse-paste-selection": {
    groups: ["native-core"],
    evidence: [
      "benchmark:input.keypress-echo",
      "benchmark:input.paste-echo",
      "benchmark:mouse.click-release",
      "benchmark:selection.drag-stability",
      "test:test/cli/tui/native-vertical-slice.test.ts",
    ],
  },
  "focus.modal-ownership": {
    groups: ["focus-manager", "native-core", "native-phase6"],
    evidence: [
      "test:test/cli/tui/focus-manager.test.ts",
      "test:test/cli/tui/native-vertical-slice.test.ts",
      "test:test/cli/tui/native-phase6.test.ts",
    ],
  },
  "scroll.viewport": {
    groups: ["native-phase6"],
    evidence: ["benchmark:scroll.long-cjk-wrapped", "test:test/cli/tui/native-phase6.test.ts"],
  },
  "text.cjk-ansi-long-lines": {
    groups: ["native-phase6"],
    evidence: ["benchmark:scroll.long-cjk-wrapped", "test:test/cli/tui/native-phase6.test.ts"],
  },
  "prompt.autocomplete": {
    groups: ["prompt-editor"],
    evidence: ["test:test/cli/tui/prompt-editor.test.ts", "test:test/cli/tui/prompt-view-model.test.ts"],
  },
  "dialog.command-provider-permission": {
    groups: ["native-core", "native-phase6"],
    evidence: ["test:test/cli/tui/native-vertical-slice.test.ts", "test:test/cli/tui/native-phase6.test.ts"],
  },
  "debug.crash-reporting": {
    groups: ["debug-diagnostics"],
    evidence: [
      "test:test/debug/diagnostic-log.test.ts",
      "test:test/cli/tui/native-diagnostics.test.ts",
      "code:src/cli/cmd/tui/thread.ts",
      "code:src/cli/cmd/tui/worker.ts",
    ],
  },
  "extension.plugin-slots": {
    groups: ["renderer-contract"],
    evidence: [
      "test:test/cli/tui/renderer-contract.test.ts",
      "criterion:plugins.ui-slots",
      "adr:automatosx/adr/ADR-001-adopt-no-effect-runtime-and-react-ink-tui.md",
    ],
  },
  "packaging.enterprise-offline": {
    groups: ["renderer-contract"],
    evidence: [
      "code:script/build.ts",
      "script:script/tui-renderer-evidence.ts",
      "workflow:.github/workflows/ax-code-tui-renderer.yml",
    ],
  },
}

function value(name: string, argv = process.argv.slice(2)) {
  const idx = argv.indexOf(name)
  if (idx < 0) return
  const next = argv[idx + 1]
  if (!next || next.startsWith("--")) throw new Error(`Missing value for ${name}`)
  return next
}

function flag(name: string, argv = process.argv.slice(2)) {
  return argv.includes(name)
}

async function writeJSON(file: string, value: unknown) {
  assertTuiBenchmarkOutputPath(file)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

async function runVerificationGroup(
  group: ContractVerificationGroup,
  timeoutMs: number,
): Promise<ContractVerificationResult> {
  const proc = Bun.spawn({
    cmd: [process.execPath, "test", ...group.files, "--timeout", String(timeoutMs)],
    cwd: PACKAGE_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n")
  return {
    ok: exitCode === 0,
    output: output || undefined,
  }
}

function contractStatus(
  requirement: TuiRendererContractRequirement,
  verification: Map<ContractGroupID, ContractVerificationResult>,
): TuiRendererContractStatus {
  const config = CONTRACT_REQUIREMENTS[requirement.id]
  if (!config) {
    return {
      id: requirement.id,
      status: "failed",
      note: `Missing contract evidence mapping for ${requirement.id}.`,
    }
  }

  const failed = (config.groups ?? []).flatMap((groupID) => {
    const result = verification.get(groupID)
    return result && !result.ok ? [{ groupID, output: result.output }] : []
  })
  if (failed.length > 0) {
    return {
      id: requirement.id,
      status: "failed",
      note: failed
        .map(({ groupID, output }) => {
          const detail = output?.split("\n").find(Boolean)
          return `${groupID} verification failed${detail ? `: ${detail}` : ""}`
        })
        .join("; "),
      evidence: config.evidence,
    }
  }

  return {
    id: requirement.id,
    status: "passed",
    evidence: config.evidence,
  }
}

export async function createTuiRendererContractReport(input: {
  requirements: TuiRendererContractRequirement[]
  verify?: boolean
  timeoutMs?: number
}): Promise<TuiRendererContractReport> {
  const timeoutMs = input.timeoutMs ?? 30_000
  const verification = new Map<ContractGroupID, ContractVerificationResult>()

  if (input.verify !== false) {
    for (const group of CONTRACT_GROUPS) {
      verification.set(group.id, await runVerificationGroup(group, timeoutMs))
    }
  } else {
    for (const group of CONTRACT_GROUPS) {
      verification.set(group.id, { ok: true })
    }
  }

  return {
    version: TUI_RENDERER_CONTRACT_VERSION,
    statuses: input.requirements.map((requirement) => contractStatus(requirement, verification)),
  }
}

async function main() {
  const timeoutMs = Number(value("--timeout-ms") ?? "30000")
  const output = value("--output")
  const report = await createTuiRendererContractReport({
    requirements: (await import("../src/cli/cmd/tui/renderer-contract")).TUI_RENDERER_CONTRACT,
    verify: !flag("--no-verify"),
    timeoutMs,
  })

  if (output) await writeJSON(path.resolve(output), report)
  console.log(JSON.stringify(report, null, 2))
  if (report.statuses.some((status) => status.status === "failed")) process.exitCode = 1
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
