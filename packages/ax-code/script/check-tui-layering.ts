import path from "node:path"

const ext = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"])

function imports(text: string) {
  const out = [] as string[]
  for (const match of text.matchAll(/from\s+["']([^"']+)["']/g)) out.push(match[1] ?? "")
  for (const match of text.matchAll(/import\s+["']([^"']+)["']/g)) out.push(match[1] ?? "")
  return out
}

function rule(spec: string): TuiLayeringGuardrails.Rule | undefined {
  if (spec === "solid-js" || spec.startsWith("solid-js/") || spec.startsWith("@solid-primitives/")) return "solid"
  if (spec.startsWith("@opentui/")) return "renderer"
}

function skip(file: string) {
  return file.includes("/node_modules/") || file.includes("/dist/") || file.includes("/.git/") || file.includes("/.turbo/")
}

export namespace TuiLayeringGuardrails {
  export const Patterns = [
    "src/cli/cmd/tui/**/*view-model.ts",
    "src/cli/cmd/tui/**/layout.ts",
    "src/cli/cmd/tui/component/prompt/footer-layout.ts",
    "src/cli/cmd/tui/component/prompt/footer-toggle.ts",
    "src/cli/cmd/tui/component/prompt/part.ts",
    "src/cli/cmd/tui/context/sync-bootstrap-phase.ts",
    "src/cli/cmd/tui/context/sync-bootstrap-phase-plan.ts",
    "src/cli/cmd/tui/context/sync-bootstrap-plan.ts",
    "src/cli/cmd/tui/context/sync-bootstrap-controller.ts",
    "src/cli/cmd/tui/context/sync-bootstrap-flow.ts",
    "src/cli/cmd/tui/context/sync-bootstrap-request.ts",
    "src/cli/cmd/tui/context/sync-bootstrap-runner.ts",
    "src/cli/cmd/tui/context/sync-bootstrap-store.ts",
    "src/cli/cmd/tui/context/sync-bootstrap-task.ts",
    "src/cli/cmd/tui/context/sync-event-dispatch.ts",
    "src/cli/cmd/tui/context/sync-event-router.ts",
    "src/cli/cmd/tui/context/sync-event-store.ts",
    "src/cli/cmd/tui/context/sync-message-event.ts",
    "src/cli/cmd/tui/context/sync-lifecycle.ts",
    "src/cli/cmd/tui/context/sync-query.ts",
    "src/cli/cmd/tui/context/sync-result.ts",
    "src/cli/cmd/tui/context/sync-request-decision.ts",
    "src/cli/cmd/tui/context/sync-request-event.ts",
    "src/cli/cmd/tui/context/sync-state.ts",
    "src/cli/cmd/tui/context/sync-startup.ts",
    "src/cli/cmd/tui/context/sync-subscription.ts",
    "src/cli/cmd/tui/context/sync-runtime-event.ts",
    "src/cli/cmd/tui/context/sync-runtime-sync.ts",
    "src/cli/cmd/tui/context/sync-runtime-store.ts",
    "src/cli/cmd/tui/context/sync-session-coordinator.ts",
    "src/cli/cmd/tui/context/sync-session-event.ts",
    "src/cli/cmd/tui/context/sync-session-fetch.ts",
    "src/cli/cmd/tui/context/sync-session-store.ts",
    "src/cli/cmd/tui/context/local-util.ts",
    "src/cli/cmd/tui/context/sync-util.ts",
    "src/cli/cmd/tui/performance-criteria.ts",
    "src/cli/cmd/tui/renderer-contract.ts",
    "src/cli/cmd/tui/renderer-decision.ts",
    "src/cli/cmd/tui/routes/session/activity.ts",
    "src/cli/cmd/tui/routes/session/branch.ts",
    "src/cli/cmd/tui/routes/session/child.ts",
    "src/cli/cmd/tui/routes/session/compare.ts",
    "src/cli/cmd/tui/routes/session/display-command-helpers.ts",
    "src/cli/cmd/tui/routes/session/format.ts",
    "src/cli/cmd/tui/routes/session/graph.ts",
    "src/cli/cmd/tui/routes/session/messages.ts",
    "src/cli/cmd/tui/routes/session/navigation.ts",
    "src/cli/cmd/tui/routes/session/revert.ts",
    "src/cli/cmd/tui/routes/session/rollback.ts",
    "src/cli/cmd/tui/routes/session/route.ts",
    "src/cli/cmd/tui/routes/session/sidebar-eta.ts",
    "src/cli/cmd/tui/routes/session/usage.ts",
    "src/cli/cmd/tui/util/microtask.ts",
    "src/cli/cmd/tui/util/request-headers.ts",
    "src/cli/cmd/tui/util/reconnect-recovery.ts",
    "src/cli/cmd/tui/util/resilient-stream.ts",
    "src/cli/cmd/tui/util/startup-task.ts",
  ] as const

  export type Rule = "solid" | "renderer"

  export interface Violation {
    file: string
    spec: string
    rule: Rule
  }

  export async function listFiles(root: string) {
    const out = new Set<string>()
    for (const pattern of Patterns) {
      for await (const file of new Bun.Glob(pattern).scan({ cwd: root, absolute: true })) {
        if (skip(file)) continue
        if (!ext.has(path.extname(file))) continue
        out.add(path.relative(root, file))
      }
    }
    return [...out].sort()
  }

  export async function check(root: string): Promise<Violation[]> {
    const out = [] as Violation[]
    for (const file of await listFiles(root)) {
      const text = await Bun.file(path.join(root, file)).text()
      for (const spec of imports(text)) {
        const hit = rule(spec)
        if (!hit) continue
        out.push({ file, spec, rule: hit })
      }
    }
    return out
  }

  export function format(input: Violation) {
    return `${input.file} imports ${input.spec} (${input.rule})`
  }
}

if (import.meta.main) {
  const root = path.resolve(import.meta.dir, "..")
  const violations = await TuiLayeringGuardrails.check(root)
  if (violations.length === 0) {
    console.log("ok: no tui layering guardrail violations found")
  } else {
    console.log("# TUI Layering Guardrail Violations")
    for (const item of violations) {
      console.log(`- ${TuiLayeringGuardrails.format(item)}`)
    }
    process.exit(1)
  }
}
