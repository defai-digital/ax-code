import { describe, expect, test } from "bun:test"
import path from "path"

const SRC = path.join(import.meta.dir, "../../src")

async function source(relativePath: string) {
  return Bun.file(path.join(SRC, relativePath)).text()
}

describe("bug report lifecycle visibility guards", () => {
  test("keeps non-critical upgrade checks observable", async () => {
    const worker = await source("cli/cmd/tui/worker.ts")
    const thread = await source("cli/cmd/tui/thread.ts")

    expect(worker).toContain('Log.Default.debug("upgrade check failed"')
    expect(worker).not.toContain("await upgrade().catch(() => {})")
    expect(thread).toContain('log.debug("upgrade check request failed"')
    expect(thread).not.toContain('client.call("checkUpgrade", { directory: cwd }).catch(() => {})')
  })

  test("keeps process termination cleanup failures observable", async () => {
    const bash = await source("tool/bash.ts")
    const prompt = await source("session/prompt.ts")

    expect(bash).toContain('log.warn("bash abort kill failed"')
    expect(bash).toContain('log.warn("bash timeout kill failed"')
    expect(bash).toContain('log.warn("bash pre-aborted kill failed"')
    expect(bash).not.toContain("void kill().catch(() => {})")
    expect(prompt).toContain('log.warn("shell abort kill failed"')
    expect(prompt).toContain('log.warn("shell timeout kill failed"')
  })

  test("keeps directory discovery fallback failures observable", async () => {
    const file = await source("file/index.ts")
    const project = await source("project/project.ts")

    expect(file).toContain('log.warn("failed to read project directory"')
    expect(file).toContain('log.warn("failed to read nested project directory"')
    expect(file).toContain('log.warn("failed to list directory"')
    expect(project).toContain('log.warn("project icon discovery failed"')
    expect(project).not.toContain("void discover(prev).catch(() => undefined)")
  })

  test("keeps best-effort DRE and mDNS cleanup failures observable", async () => {
    const dreGraph = await source("server/routes/dre-graph.ts")
    const mdns = await source("server/mdns.ts")

    expect(dreGraph).toContain('log.warn("failed to load DRE branch rank"')
    expect(dreGraph).toContain('log.warn("failed to load DRE rollback points"')
    expect(dreGraph).not.toContain("SessionBranchRank.family(sessionID).catch(() => undefined)")
    expect(dreGraph).not.toContain("SessionRollback.points(sessionID).catch((): SessionRollback.Point[] => [])")
    expect(mdns).toContain('log.warn("mDNS cleanup after publish failure failed"')
    expect(mdns).not.toContain("} catch {}")
  })

  test("keeps macOS clipboard image fallback failures observable", async () => {
    const clipboard = await source("cli/cmd/tui/util/clipboard.ts")

    expect(clipboard).toContain('log.debug("macOS clipboard image read failed"')
    expect(clipboard).toContain('log.debug("clipboard temporary image cleanup failed"')
  })

  test("keeps session status timers bound to the current route session", async () => {
    const sessionRoute = await source("cli/cmd/tui/routes/session/index.tsx")

    expect(sessionRoute).toContain("createEffect(() => {")
    expect(sessionRoute).toContain("const sessionID = route.sessionID")
    expect(sessionRoute).toContain("sync.data.session_status?.[sessionID]")
  })
})
