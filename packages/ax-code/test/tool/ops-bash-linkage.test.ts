import { describe, expect, test, vi } from "vitest"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { SessionID } from "../../src/session/schema"
import { OperationPlanID } from "../../src/operation/id"
import { OperationJournal, OperationPlan } from "../../src/operation/query"
import { recordDestructiveApproval } from "../../src/tool/ops-shared"

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

function createApprovedPlan(
  projectID: (typeof Instance.project)["id"],
  canonical: unknown,
  originSessionID?: SessionID,
) {
  const hash = OperationPlan.create({
    id: OperationPlanID.ascending(),
    projectID,
    kind: "cloud-mutation",
    canonical,
    originSessionID,
  })
  const plan = OperationPlan.byHash(projectID, hash)!
  OperationPlan.transition(plan.id, "approved")
  return plan
}

const INPUT = {
  commands: ["aws ec2 terminate-instances --instance-ids i-0123456789abcdef0"],
  reason: "terminates EC2 instances",
}

describe("recordDestructiveApproval", () => {
  test(
    "links the approval to the approved plan of the current session and chains the hash",
    withProject(() => {
      const projectID = Instance.project.id
      const sessionID = SessionID.make("session_link_1")
      const plan = createApprovedPlan(projectID, { intent: "resize cluster" }, sessionID)

      const result = recordDestructiveApproval({ projectID, sessionID, ...INPUT })

      expect(result).toMatchObject({ planID: plan.id, sequence: 1, unplanned: false })
      const entries = OperationJournal.list(plan.id)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ actor: "user", status: "approved", session_id: sessionID })
      expect(entries[0]!.payload_json).toEqual({ source: "bash_destructive", ...INPUT })
      expect(entries[0]!.prev_entry_hash).toBeNull()
      expect(OperationJournal.verifyChain(plan.id)).toEqual({ ok: true })
    }),
  )

  test(
    "prefers the current session's plan over a newer approved plan from another session",
    withProject(() => {
      const projectID = Instance.project.id
      const otherSession = SessionID.make("session_link_other")
      const ownSession = SessionID.make("session_link_own")
      createApprovedPlan(projectID, { intent: "open port 443" }, otherSession)
      const own = createApprovedPlan(projectID, { intent: "open port 22" }, ownSession)

      const result = recordDestructiveApproval({ projectID, sessionID: ownSession, ...INPUT })

      expect(result!.planID).toBe(own.id)
      expect(OperationJournal.list(own.id)).toHaveLength(1)
    }),
  )

  test(
    "falls back to the newest approved plan of the project when the session has none",
    withProject(() => {
      const projectID = Instance.project.id
      const otherSession = SessionID.make("session_link_other")
      const plan = createApprovedPlan(projectID, { intent: "delete bucket" }, otherSession)

      const result = recordDestructiveApproval({
        projectID,
        sessionID: SessionID.make("session_link_unrelated"),
        ...INPUT,
      })

      expect(result!.planID).toBe(plan.id)
      expect(OperationJournal.latestEntry(plan.id)!.status).toBe("approved")
    }),
  )

  test(
    "creates the unplanned-mutations sentinel once and reuses it for later approvals",
    withProject(() => {
      const projectID = Instance.project.id
      const sessionID = SessionID.make("session_link_sentinel")

      const first = recordDestructiveApproval({ projectID, sessionID, ...INPUT })
      const second = recordDestructiveApproval({
        projectID,
        sessionID,
        commands: ["gcloud projects delete my-project"],
        reason: "deletes a GCP project",
      })

      // Exactly one sentinel plan, created once and shared by both entries.
      const plans = OperationPlan.listByProject(projectID)
      expect(plans).toHaveLength(1)
      expect(plans[0]).toMatchObject({ kind: "unplanned-mutations", status: "draft" })
      expect(first).toMatchObject({ planID: plans[0]!.id, unplanned: true })
      expect(second).toMatchObject({ planID: plans[0]!.id, sequence: 2, unplanned: true })

      const entries = OperationJournal.list(plans[0]!.id)
      expect(entries.map((e) => e.sequence)).toEqual([1, 2])
      expect(entries[0]!.payload_json).toMatchObject({ source: "bash_destructive", unplanned: true })
      expect(entries[1]!.prev_entry_hash).toBe(entries[0]!.entry_hash)
      expect(OperationJournal.verifyChain(plans[0]!.id)).toEqual({ ok: true })
    }),
  )

  test(
    "resolves without throwing when journaling fails",
    withProject(() => {
      const projectID = Instance.project.id
      const failing = vi.spyOn(OperationJournal, "append").mockImplementation(() => {
        throw new Error("disk full")
      })

      const result = recordDestructiveApproval({
        projectID,
        sessionID: SessionID.make("session_link_failure"),
        ...INPUT,
      })

      expect(result).toBeUndefined()
      failing.mockRestore()
    }),
  )
})
