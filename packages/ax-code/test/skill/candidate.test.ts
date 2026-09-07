import fs from "node:fs/promises"
import path from "node:path"
import { expect, test } from "vitest"
import { SkillCandidate } from "../../src/skill/candidate"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { currentSourceState } from "../../src/quality/source-state"
import { tmpdir } from "../fixture/fixture"

async function verification(sessionID: SessionID) {
  const messageID = MessageID.ascending()
  const partID = PartID.ascending()
  const sourceState = await currentSourceState(Instance.worktree, "git")
  const info: MessageV2.Assistant = {
    id: messageID,
    sessionID,
    role: "assistant",
    parentID: MessageID.ascending(),
    agent: "build",
    mode: "build",
    modelID: ModelID.make("test"),
    providerID: ProviderID.make("test"),
    time: { created: Date.now() },
    path: { cwd: Instance.directory, root: Instance.worktree },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
  const part: MessageV2.ToolPart = {
    id: partID,
    messageID,
    sessionID,
    type: "tool",
    tool: "verify_project",
    callID: partID,
    state: {
      status: "completed",
      input: {},
      output: "Checks passed",
      title: "verification",
      time: { start: Date.now(), end: Date.now() },
      metadata: {
        passed: true,
        verificationEnvelopes: [
          {
            schemaVersion: 1,
            workflow: "qa",
            scope: { kind: "workspace" },
            command: { runner: "node", argv: ["--test"], cwd: Instance.directory },
            result: { name: "tests", type: "test", passed: true, status: "passed", issues: [], duration: 1 },
            structuredFailures: [],
            artifactRefs: [],
            source: { tool: "verify_project", version: "test", runId: sessionID },
            sourceState,
            execution: {
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
              exitCode: 0,
              signal: null,
              timedOut: false,
              outputTruncated: false,
            },
          },
        ],
      },
    },
  }
  await Session.updateMessageWithParts(info, [part])
  return { evidence: { sessionID, messageID, partID }, part }
}
const proposal = (evidence: SkillCandidate.Evidence) => ({
  name: "verified-procedure",
  description: "Use this procedure to validate arithmetic changes.",
  applicability: "Apply when changing arithmetic helpers with an existing test suite.",
  procedure: "Read the helper, make a focused correction, and run the independent tests.",
  evidence,
})

test("requires independent canonical verification before explicit promotion and conflict-safe retirement", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const first = await verification((await Session.create({})).id)
      const second = await verification((await Session.create({})).id)
      const candidate = await SkillCandidate.propose(proposal(first.evidence))
      await expect(SkillCandidate.propose(proposal(first.evidence))).rejects.toThrow("already exists")
      await expect(SkillCandidate.promote(candidate.name)).rejects.toThrow("Independent")
      await expect(SkillCandidate.validate(candidate.name, first.evidence)).rejects.toThrow("different session")
      await SkillCandidate.validate(candidate.name, second.evidence)
      const promoted = await SkillCandidate.promote(candidate.name)
      const original = await fs.readFile(promoted.path, "utf8")
      expect(original).toContain(candidate.procedure)
      await fs.writeFile(promoted.path, "User changed this skill")
      await expect(SkillCandidate.retire(candidate.name)).rejects.toThrow("conflict")
      expect(await fs.readFile(promoted.path, "utf8")).toBe("User changed this skill")
      await fs.writeFile(promoted.path, original)
      expect((await SkillCandidate.retire(candidate.name)).promotion?.status).toBe("retired")
      await expect(fs.stat(promoted.path)).rejects.toThrow()
      expect((await SkillCandidate.retire(candidate.name)).promotion?.status).toBe("retired")
    },
  })
})

test("rejects self-reported, reverted, stale and escaping proposals", async () => {
  await using tmp = await tmpdir({ git: true })
  await using outside = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const first = await verification((await Session.create({})).id)
      const second = await verification((await Session.create({})).id)
      const forged = { ...first.part, state: { ...first.part.state, metadata: { passed: true } } } as MessageV2.ToolPart
      await Session.updatePart(forged)
      await expect(SkillCandidate.propose(proposal(first.evidence))).rejects.toThrow()
      await Session.updatePart(first.part)
      await Session.setRevert({ sessionID: first.evidence.sessionID, revert: { messageID: first.evidence.messageID } })
      await expect(SkillCandidate.propose(proposal(first.evidence))).rejects.toThrow("reverted")
      await Session.clearRevert(first.evidence.sessionID)
      const candidate = await SkillCandidate.propose(proposal(first.evidence))
      await SkillCandidate.validate(candidate.name, second.evidence)
      const dirty = path.join(tmp.path, "dirty.txt")
      await fs.writeFile(dirty, "changed")
      await expect(SkillCandidate.promote(candidate.name)).rejects.toThrow("clean")
      await fs.unlink(dirty)
      // Ignore only the local skill directory so the symlink reaches path admission.
      await fs.appendFile(path.join(tmp.path, ".git", "info", "exclude"), "\n.ax-code\n")
      await fs.symlink(outside.path, path.join(tmp.path, ".ax-code"))
      await expect(SkillCandidate.promote(candidate.name)).rejects.toThrow("real directories")
      expect(await fs.readdir(outside.path)).toEqual([])
      expect(SkillCandidate.Proposal.safeParse({ ...proposal(first.evidence), name: "../escape" }).success).toBe(false)
    },
  })
})
