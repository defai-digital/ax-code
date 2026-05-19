import { describe, expect, test } from "bun:test"
import path from "path"

const SRC = path.join(import.meta.dir, "../../src")
const REPO = path.join(import.meta.dir, "../../../..")

async function source(relativePath: string) {
  return Bun.file(path.join(SRC, relativePath)).text()
}

async function repoSource(relativePath: string) {
  return Bun.file(path.join(REPO, relativePath)).text()
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

  test("keeps MCP status updates race-safe", async () => {
    const mcp = await source("mcp/index.ts")

    expect(mcp).toContain('s.status[name] = {\n          status: "failed" as const')
    expect(mcp).toContain('if (s.status[clientName]?.status !== "disabled")')
    expect(mcp).toContain('s.status[clientName] = { status: "failed" as const')
    expect(mcp).toContain('s.status[clientName]?.status !== "connected"')
  })

  test("keeps JSON migration inputs immutable while stripping embedded ids", async () => {
    const migration = await source("storage/json-migration.ts")

    expect(migration).toContain("const { id: _id, sessionID: _sessionID, ...rest } = data")
    expect(migration).toContain("const { id: _id, messageID: _messageID, sessionID: _sessionID, ...rest } = data")
    expect(migration).not.toContain("delete rest.id")
    expect(migration).not.toContain("delete rest.sessionID")
    expect(migration).not.toContain("delete rest.messageID")
  })

  test("keeps worktree cleanup ordered before deleting directories", async () => {
    const worktree = await source("worktree/index.ts")

    expect(worktree).toContain("await fs.rm(info.directory, { recursive: true, force: true })")
    expect(worktree).not.toContain("fs.rmdir(info.directory)")

    const cleanupIndex = worktree.indexOf("await cleanupInstanceAndSandbox()")
    const cleanIndex = worktree.indexOf("await clean(directory)", cleanupIndex)
    expect(cleanupIndex).toBeGreaterThan(-1)
    expect(cleanIndex).toBeGreaterThan(cleanupIndex)
  })

  test("keeps Rust daemon and watcher send failures visible", async () => {
    const daemon = await repoSource("crates/ax-code-daemon/src/daemon.rs")
    const fsNative = await repoSource("crates/ax-code-fs/src/lib.rs")

    expect(daemon).toContain('eprintln!("daemon: failed to write response body')
    expect(daemon).toContain('eprintln!("daemon: failed to flush response')
    expect(daemon).not.toContain("let _ = writer.write_all")
    expect(fsNative).toContain(".send(WatchEvent")
    expect(fsNative).toContain(".is_err()")
    expect(fsNative).toContain("break;")
  })

  test("keeps poll watcher ticks from leaking unhandled rejections", async () => {
    const watcher = await source("file/watcher.ts")

    expect(watcher).toContain('log.warn("poll watcher tick error"')
    expect(watcher).toContain("void tick().catch((error) => {")
    expect(watcher).not.toContain("void tick()\n          }, POLL_MS)")
  })
})
