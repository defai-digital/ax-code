import path from "path"

export const root = path.join(import.meta.dir, "..")

const live = new Set(["test/session/structured-output-integration.test.ts"])

const e2e = new Set([
  "test/cli/smoke.test.ts",
  "test/control-plane/session-proxy-middleware.test.ts",
  "test/control-plane/workspace-sync.test.ts",
  "test/control-plane/workspace-server-sse.test.ts",
  "test/mcp/oauth-browser.test.ts",
  "test/script/update-models.test.ts",
  "test/server/global-session-list.test.ts",
  "test/server/project-init-git.test.ts",
  "test/server/session-list.test.ts",
  "test/server/session-messages.test.ts",
  "test/server/session-select.test.ts",
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

export async function list() {
  const out = [] as string[]
  for await (const file of new Bun.Glob("test/**/*.test.ts").scan({ cwd: root, absolute: false })) {
    out.push(file)
  }
  out.sort()
  return out
}

export function pick(all: string[], name: string) {
  if (name === "live") return all.filter((file) => live.has(file))
  if (name === "e2e") return all.filter((file) => e2e.has(file))
  if (name === "recovery") return all.filter((file) => recovery.has(file))
  if (name === "deterministic") return all.filter((file) => !live.has(file) && !e2e.has(file))
  if (name === "unit") return all.filter((file) => !live.has(file) && !e2e.has(file) && !recovery.has(file))
  throw new Error(`Unknown test group: ${name}`)
}

export function check(all: string[]) {
  const known = [...live, ...e2e, ...recovery]
  const miss = known.filter((file) => !all.includes(file))
  if (miss.length) throw new Error(`Missing grouped tests:\n${miss.join("\n")}`)
}
