import { describe, expect, test } from "vitest"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Database, eq } from "../../src/storage/db"
import { Hash } from "../../src/util/hash"
import { Log } from "../../src/util/log"
import { OperationJournalID, OperationPlanID, OperationTokenID } from "../../src/operation/id"
import { OperationTokenTable } from "../../src/operation/operation.sql"
import { OperationJournal, OperationPlan, OperationToken } from "../../src/operation/query"

Log.init({ print: false })

function withProject(fn: () => void | Promise<void>) {
  return async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn,
    })
  }
}

function makePlan(projectID: (typeof Instance.project)["id"], canonical: unknown) {
  return OperationPlan.create({
    id: OperationPlanID.ascending(),
    projectID,
    kind: "cloud-mutation",
    canonical,
  })
}

describe("OperationPlan", () => {
  test(
    "create + byHash roundtrip",
    withProject(() => {
      const projectID = Instance.project.id
      const canonical = {
        target: { provider: "aws", account: "123" },
        steps: [{ effect: "delete", blast_radius: "high" }],
      }
      const hash = makePlan(projectID, canonical)

      const row = OperationPlan.byHash(projectID, hash)
      expect(row).toBeDefined()
      expect(row!.canonical_hash).toBe(hash)
      expect(row!.status).toBe("draft")
      expect(row!.kind).toBe("cloud-mutation")
      expect(row!.canonical_json).toEqual(canonical)

      expect(OperationPlan.get(row!.id)!.id).toBe(row!.id)
    }),
  )

  test(
    "duplicate canonical in the same project throws on the unique index",
    withProject(() => {
      const projectID = Instance.project.id
      const canonical = { target: "gcp", intent: "delete bucket" }
      makePlan(projectID, canonical)
      expect(() => makePlan(projectID, canonical)).toThrow()
    }),
  )

  test(
    "transition moves status; listByProject filters by status",
    withProject(() => {
      const projectID = Instance.project.id
      const hash = makePlan(projectID, { intent: "open port" })
      const id = OperationPlan.byHash(projectID, hash)!.id

      expect(OperationPlan.get(id)!.status).toBe("draft")
      OperationPlan.transition(id, "approved")
      expect(OperationPlan.get(id)!.status).toBe("approved")

      expect(OperationPlan.listByProject(projectID, { status: "approved" }).map((r) => r.id)).toContain(id)
      expect(OperationPlan.listByProject(projectID, { status: "draft" })).toEqual([])
      expect(OperationPlan.listByProject(projectID).length).toBe(1)
    }),
  )
})

describe("OperationJournal", () => {
  test(
    "append keeps sequence order and the hash chain verifies",
    withProject(() => {
      const projectID = Instance.project.id
      const planHash = makePlan(projectID, { intent: "rotate credentials" })
      const planID = OperationPlan.byHash(projectID, planHash)!.id

      let prev: string | undefined
      const hashes: string[] = []
      for (const [i, status] of ["planned", "approved", "executed"].entries()) {
        const hash = OperationJournal.append({
          id: OperationJournalID.ascending(),
          planID,
          projectID,
          sequence: i + 1,
          actor: "agent",
          status: status as "planned" | "approved" | "executed",
          planCanonicalHash: planHash,
          payload: { step: i + 1 },
          prevEntryHash: prev,
        })
        hashes.push(hash)
        prev = hash
      }

      const entries = OperationJournal.list(planID)
      expect(entries.map((e) => e.sequence)).toEqual([1, 2, 3])
      expect(entries.map((e) => e.entry_hash)).toEqual(hashes)
      expect(OperationJournal.latestEntry(planID)!.sequence).toBe(3)
      expect(OperationJournal.verifyChain(planID)).toEqual({ ok: true })

      // Appending with a wrong prevEntryHash (history rewritten or chain
      // forked) breaks verification at exactly that sequence.
      OperationJournal.append({
        id: OperationJournalID.ascending(),
        planID,
        projectID,
        sequence: 4,
        actor: "agent",
        status: "verified",
        planCanonicalHash: planHash,
        payload: { step: 4 },
        prevEntryHash: "tampered",
      })
      expect(OperationJournal.verifyChain(planID)).toEqual({ ok: false, brokenAt: 4 })
    }),
  )

  test(
    "listByProject orders newest first and filters by status",
    withProject(() => {
      const projectID = Instance.project.id
      const planHash = makePlan(projectID, { intent: "resize cluster" })
      const planID = OperationPlan.byHash(projectID, planHash)!.id

      for (const [i, status] of ["planned", "executed"].entries()) {
        OperationJournal.append({
          id: OperationJournalID.ascending(),
          planID,
          projectID,
          sequence: i + 1,
          actor: "agent",
          status: status as "planned" | "executed",
          planCanonicalHash: planHash,
          payload: { step: i + 1 },
        })
      }

      const all = OperationJournal.listByProject(projectID)
      expect(all.length).toBe(2)
      expect(all[0]!.time_created).toBeGreaterThanOrEqual(all[1]!.time_created)
      expect(OperationJournal.listByProject(projectID, { status: "executed" }).length).toBe(1)
      expect(OperationJournal.listByProject(projectID, { limit: 1 }).length).toBe(1)
    }),
  )
})

describe("OperationToken", () => {
  test(
    "issue returns the raw secret once; consume is single-use with TTL",
    withProject(() => {
      const projectID = Instance.project.id
      const planHash = makePlan(projectID, { intent: "drop firewall rule" })
      const planID = OperationPlan.byHash(projectID, planHash)!.id

      const secret = OperationToken.issue({
        id: OperationTokenID.ascending(),
        projectID,
        planID,
        purpose: "approve",
        ttlMs: 10 * 60 * 1000,
      })

      // The raw bearer secret is base64url (43 chars), never the stored hash.
      expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
      const stored = Database.use((db) =>
        db.select().from(OperationTokenTable).where(eq(OperationTokenTable.plan_id, planID)).all(),
      )
      expect(stored.length).toBe(1)
      expect(stored[0]!.token_hash).not.toBe(secret)
      expect(stored[0]!.token_hash).toBe(Hash.fast(secret))
      expect(stored[0]!.consumed_at).toBeNull()

      const first = OperationToken.consume({ token: secret })
      expect(first).toEqual({ ok: true, planID })

      // Single use: the second redemption loses the conditional UPDATE race.
      expect(OperationToken.consume({ token: secret })).toEqual({ ok: false, reason: "already_consumed" })

      // Garbage tokens never existed.
      expect(OperationToken.consume({ token: "no-such-token" })).toEqual({ ok: false, reason: "not_found" })

      // Expiry is checked lazily at consume time.
      const expiring = OperationToken.issue({
        id: OperationTokenID.ascending(),
        projectID,
        planID,
        purpose: "approve",
        ttlMs: 1000,
      })
      expect(OperationToken.consume({ token: expiring, now: Date.now() + 60_000 })).toEqual({
        ok: false,
        reason: "expired",
      })
      // ...but pruning only removes strictly-expired rows relative to now.
      expect(OperationToken.pruneExpired(Date.now() + 120_000)).toBe(1)
      expect(OperationToken.pruneExpired()).toBe(0)
    }),
  )
})
