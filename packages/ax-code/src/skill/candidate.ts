import fs from "node:fs"
import path from "node:path"
import matter from "gray-matter"
import z from "zod"
import { Instance } from "@/project/instance"
import { Global } from "@/global"
import { Hash } from "@/util/hash"
import { git } from "@/util/git"
import { FileLock } from "@/util/filelock"
import { Storage } from "@/storage/storage"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { SessionEvidence } from "@/session/evidence"
import { SessionID, MessageID, PartID } from "@/session/schema"
import { currentSourceState } from "@/quality/source-state"
import { VerificationEnvelopeSchema } from "@/quality/verification-envelope"
import { SkillCreateRequest } from "./authoring"

export namespace SkillCandidate {
  const Name = SkillCreateRequest.shape.name
  export const Evidence = z.object({ sessionID: SessionID.zod, messageID: MessageID.zod, partID: PartID.zod }).strict()
  export type Evidence = z.infer<typeof Evidence>
  export const Proposal = z
    .object({
      name: Name,
      description: z.string().trim().min(12).max(1000),
      applicability: z.string().trim().min(10).max(4000),
      procedure: z.string().trim().min(10).max(24_000),
      evidence: Evidence,
    })
    .strict()
  const Citation = Evidence.extend({ digest: z.string(), commit: z.string() })
  export const Candidate = Proposal.omit({ evidence: true })
    .extend({
      source: Citation,
      validation: Citation.optional(),
      promotion: z
        .object({ digest: z.string(), status: z.enum(["pending", "active", "retiring", "retired"]) })
        .optional(),
    })
    .strict()
  export type Candidate = z.infer<typeof Candidate>

  function key(name: string) {
    // @scan-suppress security_scan - The resolved worktree is hashed as a storage namespace; names pass the shared single-component skill-name schema.
    return ["skill-candidate", Instance.project.id, Hash.fast(path.resolve(Instance.worktree)), Name.parse(name)]
  }
  async function lock(name: string) {
    // @scan-suppress security_scan - The managed state root and fixed directory contain only a hash-derived lock filename.
    return FileLock.acquire(path.join(Global.Path.state, "skill-candidate-locks", Hash.fast(key(name).join("/"))))
  }
  export async function get(name: string) {
    return Candidate.parse(await Storage.read(key(name)))
  }

  async function cleanSourceState() {
    const state = await currentSourceState(Instance.worktree, Instance.project.vcs ?? "")
    // The fingerprint describes source bytes even in a clean checkout.
    // Check Git cleanliness separately, then match verification to those bytes.
    const status = await git(["status", "--porcelain", "--untracked-files=normal"], { cwd: Instance.worktree })
    if (!state.available || !state.commit || !state.dirtyDigest || status.exitCode !== 0 || status.text().trim())
      throw new Error("Skill candidates require a clean, committed Git worktree")
    return { commit: state.commit, dirtyDigest: state.dirtyDigest }
  }

  async function citation(input: Evidence, source: Awaited<ReturnType<typeof cleanSourceState>>) {
    const ref = Evidence.parse({ sessionID: input.sessionID, messageID: input.messageID, partID: input.partID })
    const session = await Session.get(ref.sessionID)
    if (
      session.projectID !== Instance.project.id ||
      // @scan-suppress security_scan - Canonical directory strings are compared for evidence admission; no file is opened through either value here.
      path.resolve(session.directory) !== path.resolve(Instance.directory)
    )
      throw new Error("Verification must belong to the current project directory")
    const visible = await SessionEvidence.recover(ref.sessionID, {
      messageID: ref.messageID,
      partID: ref.partID,
      limit: 1,
    })
    if (!visible.entries.some((item) => item.partID === ref.partID))
      throw new Error("Verification evidence is unavailable or reverted")
    const message = await MessageV2.get({ sessionID: ref.sessionID, messageID: ref.messageID })
    const part = message.parts.find((item) => item.id === ref.partID)
    if (
      message.info.role !== "assistant" ||
      part?.type !== "tool" ||
      part.tool !== "verify_project" ||
      part.state.status !== "completed" ||
      part.state.time.compacted ||
      part.state.metadata.passed !== true
    )
      throw new Error("A successful canonical verify_project result is required")
    const payload = part.state.metadata.verificationEnvelopes
    if (JSON.stringify(payload ?? null).length > 256_000)
      throw new Error("Verification evidence exceeds the candidate budget")
    const envelopes = z.array(VerificationEnvelopeSchema).min(1).max(20).parse(payload)
    const executed = envelopes.filter((item) => item.result.status !== "skipped")
    if (
      !executed.length ||
      !executed.some((item) => item.result.type === "test" || item.result.type === "typecheck") ||
      executed.some(
        (item) =>
          item.source.tool !== "verify_project" ||
          item.source.runId !== ref.sessionID ||
          !item.result.passed ||
          item.result.status !== "passed" ||
          !item.execution ||
          item.execution.exitCode !== 0 ||
          item.execution.signal !== null ||
          item.execution.timedOut ||
          item.sourceState?.available !== true ||
          item.sourceState.commit !== source.commit ||
          item.sourceState.dirtyDigest !== source.dirtyDigest,
      )
    )
      throw new Error("Verification must contain executed, successful checks against the current clean revision")
    return { ...ref, commit: source.commit, digest: Hash.fast(JSON.stringify(part)) }
  }

  export async function propose(input: z.infer<typeof Proposal>) {
    const request = Proposal.parse(input)
    using _ = await lock(request.name)
    const existing = await get(request.name).catch((error) => {
      if (Storage.NotFoundError.isInstance(error)) return undefined
      throw error
    })
    if (existing) throw new Error("Skill candidate already exists")
    const source = await citation(request.evidence, await cleanSourceState())
    const candidate = Candidate.parse({
      name: request.name,
      description: request.description,
      applicability: request.applicability,
      procedure: request.procedure,
      source,
    })
    await Storage.write(key(request.name), candidate)
    return candidate
  }

  export async function validate(name: string, evidence: Evidence) {
    using _ = await lock(name)
    const candidate = await get(name)
    if (candidate.promotion) throw new Error("A promoted candidate cannot be revalidated")
    const sourceState = await cleanSourceState()
    const source = await citation(candidate.source, sourceState)
    if (source.digest !== candidate.source.digest) throw new Error("Source verification changed")
    if (evidence.sessionID === candidate.source.sessionID)
      throw new Error("Validation requires a different session's verification attempt")
    candidate.validation = await citation(evidence, sourceState)
    await Storage.write(key(name), candidate)
    return candidate
  }

  function content(candidate: Candidate) {
    return matter.stringify(
      `## Applicability\n\n${candidate.applicability}\n\n## Procedure\n\n${candidate.procedure}\n`,
      { name: candidate.name, description: candidate.description },
    )
  }

  // Keep all component checks and leaf operations synchronous. Reject symlinks
  // and non-directories; never follow a candidate-supplied path or overwrite.
  function target(name: string, create: boolean) {
    let current = fs.realpathSync(Instance.worktree)
    for (const component of [".ax-code", "skill", Name.parse(name)]) {
      // @scan-suppress security_scan - Components are fixed or validated lowercase skill names; each directory is checked below with lstat to reject symlinks.
      current = path.join(current, component)
      if (create && !fs.existsSync(current)) fs.mkdirSync(current)
      const stat = fs.lstatSync(current)
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error("Skill promotion path must contain real directories only")
    }
    // @scan-suppress security_scan - The verified directory chain receives a fixed SKILL.md leaf; callers use exclusive creation or checked owned-file reads.
    return path.join(current, "SKILL.md")
  }
  function readOwn(file: string) {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    try {
      const stat = fs.fstatSync(fd)
      if (!stat.isFile() || stat.size > 40_000 || stat.nlink !== 1)
        throw new Error("Promoted skill is not an owned regular file")
      return fs.readFileSync(fd, "utf8")
    } finally {
      fs.closeSync(fd)
    }
  }

  export async function promote(name: string) {
    using _ = await lock(name)
    const candidate = await get(name)
    if (candidate.promotion?.status === "retired" || candidate.promotion?.status === "retiring")
      throw new Error("Retired candidates cannot be promoted again")
    const text = content(candidate)
    const digest = Hash.fast(text)
    if (!candidate.promotion) {
      if (!candidate.validation) throw new Error("Independent validation is required before promotion")
      const sourceState = await cleanSourceState()
      for (const ref of [candidate.source, candidate.validation]) {
        if ((await citation(ref, sourceState)).digest !== ref.digest) throw new Error("Verification evidence changed")
      }
      const file = target(name, true)
      if (fs.existsSync(file)) throw new Error("Skill already exists; promotion never overwrites")
      candidate.promotion = { digest, status: "pending" }
      await Storage.write(key(name), candidate)
    }
    if (candidate.promotion.digest !== digest) throw new Error("Candidate content changed after promotion began")
    const file = target(name, true)
    if (fs.existsSync(file)) {
      if (Hash.fast(readOwn(file)) !== digest) throw new Error("Promoted skill content conflict")
    } else {
      if (candidate.promotion.status === "active") throw new Error("Promoted skill was removed externally")
      if (!candidate.validation) throw new Error("Independent validation is required before promotion")
      const sourceState = await cleanSourceState()
      for (const ref of [candidate.source, candidate.validation]) {
        if ((await citation(ref, sourceState)).digest !== ref.digest) throw new Error("Verification evidence changed")
      }
      // Revalidate every directory after asynchronous source checks.
      target(name, false)
      const fd = fs.openSync(
        file,
        fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW,
        0o644,
      )
      try {
        fs.writeFileSync(fd, text)
        fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
    }
    candidate.promotion.status = "active"
    await Storage.write(key(name), candidate)
    return { candidate, path: file }
  }

  export async function retire(name: string) {
    using _ = await lock(name)
    const candidate = await get(name)
    if (!candidate.promotion) throw new Error("Candidate has no promotion to retire")
    if (candidate.promotion.status === "retired") return candidate
    const file = target(name, false)
    const exists = fs.existsSync(file)
    if (!exists && candidate.promotion.status !== "retiring") throw new Error("Promoted skill was removed externally")
    if (exists && Hash.fast(readOwn(file)) !== candidate.promotion.digest)
      throw new Error("Promoted skill content conflict; refusing retirement")
    candidate.promotion.status = "retiring"
    await Storage.write(key(name), candidate)
    // Recheck after asynchronous persistence before deleting this exact file.
    if (fs.existsSync(target(name, false))) {
      if (Hash.fast(readOwn(file)) !== candidate.promotion.digest)
        throw new Error("Promoted skill changed during retirement")
      fs.unlinkSync(file)
    }
    candidate.promotion.status = "retired"
    await Storage.write(key(name), candidate)
    return candidate
  }
}
