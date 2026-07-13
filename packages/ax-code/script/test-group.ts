import path from "path"
import { scan } from "./fs-compat"

export const root = path.join(import.meta.dirname, "..")

const live = new Set(["test/session/structured-output-integration.test.ts"])

const e2e = new Set([
  "test/cli/smoke.test.ts",
  "test/control-plane/session-proxy-middleware.test.ts",
  "test/control-plane/workspace-sync.test.ts",
  "test/control-plane/workspace-server-sse.test.ts",
  // Bash tool tests spawn real child processes via child_process.spawn and are
  // flaky on Bun/Linux CI — proc.exitCode is null and stdout is empty on the
  // GitHub Actions Ubuntu runner even for simple echo commands. Tests pass on
  // macOS. Kept in e2e so they run locally but don't block release CI.
  "test/tool/bash.test.ts",
  // LSP client interop spawns a real child process and is flaky on CI —
  // 30s timeouts when the handshake JSON-RPC message misses its window.
  // The other LSP test files (incremental, launch, orchestrator, server-helpers)
  // stay in deterministic; they don't spawn subprocesses.
  "test/lsp/client.test.ts",
  // Needs process isolation: mock.module leaks across files in one Bun process.
  "test/code-intelligence/query-native-dispatch.test.ts",
  "test/mcp/headers.test.ts",
  "test/mcp/oauth-callback.test.ts",
  "test/mcp/oauth-browser.test.ts",
  "test/script/update-models.test.ts",
  "test/server/global-session-list.test.ts",
  "test/server/project-init-git.test.ts",
  "test/server/session-list.test.ts",
  "test/server/session-messages.test.ts",
  "test/server/session-select.test.ts",
  // Real filesystem, ripgrep, LSP, PTY, OpenTUI, provider-CLI, and script
  // integration tests depend on host binaries/runtime flags or external process
  // behavior. Keep them out of deterministic release validation.
  "test/cli/tui/prompt-submit-key.test.ts",
  "test/file/index.test.ts",
  "test/file/ripgrep.test.ts",
  "test/lsp/perf-sampler.test.ts",
  "test/lsp/prewarm.test.ts",
  "test/lsp/workspace-symbol.test.ts",
  "test/provider/cli/cli-language-model.test.ts",
  "test/pty/pty-output-isolation.test.ts",
  "test/pty/pty-session.test.ts",
  "test/script/root-structure-script.test.ts",
  "test/tool/debug_runtime_workflow.test.ts",
  "test/tool/glob.test.ts",
  "test/tool/grep.test.ts",
  "test/tool/ls.test.ts",
  "test/tool/skill.test.ts",
  "test/tool/tool.test.ts",
  "test/tool/verify_project.test.ts",
])

const recovery = new Set([
  "test/account/repo.test.ts",
  "test/auth/auth.test.ts",
  "test/control-plane/workspace-recovery.test.ts",
  "test/isolation/isolation.test.ts",
  "test/project/project.test.ts",
  "test/provider/models.test.ts",
  "test/session/diff-recovery.test.ts",
  "test/session/message-recovery.test.ts",
  "test/session/prompt-flow.test.ts",
  "test/session/prompt-resume.test.ts",
  "test/session/session-recovery.test.ts",
])

// Heavy or timing-sensitive integration files that are intentionally excluded
// from the default and deterministic groups. They are not part of the recovery
// group either; run them directly when working on their subsystem.
const quarantined = new Set([
  "test/lsp/call-hierarchy.test.ts",
  "test/lsp/envelope-coverage.test.ts",
  "test/lsp/lsp-cache-integration.test.ts",
  "test/lsp/request-collapse.test.ts",
  "test/code-intelligence/builder.test.ts",
  "test/control-plane/sse.test.ts",
  // Passes only when it inherits state from neighboring prompt suites; when
  // isolated it leaves the resume loop running indefinitely and eventually
  // exhausts the release runner heap. Keep it as targeted integration coverage
  // until the test owns and closes its prompt-loop lifecycle.
  "test/session/prompt-resume.test.ts",
])

export const defaultExcludedTests = [...live, ...e2e, ...recovery, ...quarantined]

export async function list() {
  const out = await scan("test/**/*.test.ts", { cwd: root, absolute: false })
  out.sort()
  return out
}

export function pick(all: string[], name: string) {
  if (name === "live") return all.filter((file) => live.has(file))
  if (name === "e2e") return all.filter((file) => e2e.has(file))
  if (name === "recovery") return all.filter((file) => recovery.has(file))
  if (name === "deterministic") return all.filter((file) => !live.has(file) && !e2e.has(file) && !quarantined.has(file))
  if (name === "unit")
    return all.filter((file) => !live.has(file) && !e2e.has(file) && !recovery.has(file) && !quarantined.has(file))
  throw new Error(`Unknown test group: ${name}`)
}

export function check(all: string[]) {
  const known = defaultExcludedTests
  const miss = known.filter((file) => !all.includes(file))
  if (miss.length) throw new Error(`Missing grouped tests:\n${miss.join("\n")}`)
}
