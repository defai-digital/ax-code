import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { setTimeout as sleep } from "node:timers/promises"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { PermissionTable } from "../../src/session/session.sql"
import { SessionID } from "../../src/session/schema"
import { Database, eq } from "../../src/storage/db"
import { tmpdir } from "../fixture/fixture"

beforeEach(() => {
  // These tests need a real prompt in order to persist an "always" decision.
  vi.stubEnv("AX_CODE_ISOLATION_MODE", "workspace-write")
  vi.stubEnv("AX_CODE_ISOLATION_NETWORK", "false")
})

// Regression coverage for ADR-057 D1 / SPEC-2026-08-20-agent-backend-parity
// Phase 0 (R1): a permission granted "always" is persisted project-wide and
// every Permission.ask evaluates the caller's ruleset PLUS the
// project-scoped `approved` list (src/permission/index.ts:320-337), so a
// subagent (child) session inherits the grant with zero rule copying. This
// pins the behavior the comment above Session.create in src/tool/task.ts
// documents — do NOT copy allow rules into the durable session ruleset.

afterEach(async () => {
  vi.unstubAllEnvs()
  await Instance.disposeAll()
})

async function waitForPending(count: number) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const list = await Permission.list()
    if (list.length === count) return list
    await sleep(5)
  }
  return Permission.list()
}

describe("project-approved permission propagation to child sessions", () => {
  test("an 'always' grant from a parent session resolves as allow for a different (child) session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = SessionID.make("ses_parent")
        const child = SessionID.make("ses_child")

        // Grant "always" from the parent session via the same code path the
        // TUI/server reply takes (replyPromise persists to PermissionTable).
        const ask = Permission.ask({
          sessionID: parent,
          permission: "task",
          patterns: ["general"],
          metadata: {},
          always: ["*"],
          ruleset: [],
        })
        const pending = await waitForPending(1)
        const applied = await Permission.reply({ requestID: pending[0].id, reply: "always" })
        expect(applied).toBe(true)
        await expect(ask).resolves.toBeUndefined()

        // The grant is persisted project-wide.
        const row = Database.use((db) =>
          db.select().from(PermissionTable).where(eq(PermissionTable.project_id, Instance.project.id)).get(),
        )
        expect(row?.data).toEqual([{ permission: "task", pattern: "*", action: "allow" }])

        // A different (child) session carrying NO allow rules of its own now
        // resolves allow without prompting — Permission.ask evaluates the
        // caller's ruleset plus the project-scoped `approved` list
        // (src/permission/index.ts:327).
        await expect(
          Permission.ask({
            sessionID: child,
            permission: "task",
            patterns: ["general"],
            metadata: {},
            always: ["*"],
            ruleset: [],
          }),
        ).resolves.toBeUndefined()
        expect(await Permission.list()).toHaveLength(0)
      },
    })
  })

  test("the approved rule is loaded from PermissionTable by a fresh instance state", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ask = Permission.ask({
          sessionID: SessionID.make("ses_parent"),
          permission: "task",
          patterns: ["general"],
          metadata: {},
          always: ["*"],
          ruleset: [],
        })
        const pending = await waitForPending(1)
        await Permission.reply({ requestID: pending[0].id, reply: "always" })
        await expect(ask).resolves.toBeUndefined()
      },
    })
    // Re-provide to reload state from the stored permissions (state() reads
    // PermissionTable by project_id, src/permission/index.ts:194-212).
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(
          Permission.ask({
            sessionID: SessionID.make("ses_child"),
            permission: "task",
            patterns: ["general"],
            metadata: {},
            always: ["*"],
            ruleset: [],
          }),
        ).resolves.toBeUndefined()
        expect(await Permission.list()).toHaveLength(0)
      },
    })
  })

  test("without a project-approved rule the same child-session ask still requires prompting", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Control: with no approved rule and an empty child ruleset the ask
        // pends — the allow above comes from project propagation, not from
        // any default.
        const ask = Permission.ask({
          sessionID: SessionID.make("ses_child"),
          permission: "task",
          patterns: ["general"],
          metadata: {},
          always: ["*"],
          ruleset: [],
        })
        const pending = await waitForPending(1)
        expect(pending).toHaveLength(1)
        await Permission.reply({ requestID: pending[0].id, reply: "reject" })
        await expect(ask).rejects.toBeInstanceOf(Permission.RejectedError)
      },
    })
  })
})
