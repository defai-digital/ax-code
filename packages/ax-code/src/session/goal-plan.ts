import { createHash } from "node:crypto"
import fs from "fs"
import path from "path"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import { toErrorMessage } from "../util/error-message"
import type { SessionID } from "./schema"

export namespace GoalPlan {
  const log = Log.create({ service: "session.goal-plan" })

  export const MAX_READ_BYTES = 8 * 1024
  export const MAX_ACCEPTANCE = 5
  export const MIN_CHECKLIST = 2
  export const MAX_CHECKLIST = 8

  export const Kind = ["code-change", "analysis", "research"] as const
  export type Kind = (typeof Kind)[number]

  export type Acceptance = { id: string; text: string }
  export type Verification = { tag: "gating" | "evidence"; action: string; observation: string }

  export type Contract = {
    kind: Kind
    title: string
    acceptance: Acceptance[]
    verification: Verification[]
    nonGoals: string[]
    assumedScope: string
    implementationApproach?: string
    taskChecklist?: string[]
    risks?: string[]
  }

  export type ReadResult =
    | { status: "found"; contract: Contract }
    | { status: "missing" }
    | { status: "invalid"; error: unknown }

  export class Error extends globalThis.Error {
    readonly code: "invalid" | "missing" | "writer"
    constructor(code: "invalid" | "missing" | "writer", message: string) {
      super(message)
      this.name = "GoalPlanError"
      this.code = code
    }
  }

  export function pathFor(sessionID: SessionID, created: number) {
    const base = Instance.project.vcs
      ? path.join(Instance.worktree, ".ax-code", "goals")
      : path.join(Global.Path.data, "goals")
    return containedJoin(base, sessionID, `${created}.md`)
  }

  export function digestPathFor(sessionID: SessionID, created: number) {
    return containedJoin(path.join(Global.Path.data, "goal-contracts"), `${sessionID}-${created}.sha256`)
  }

  function containedJoin(base: string, ...parts: string[]) {
    const result = path.join(base, ...parts)
    const resolved = path.resolve(result)
    const resolvedBase = path.resolve(base)
    if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
      throw new globalThis.Error("Goal plan path escapes its directory")
    }
    return result
  }

  export function digestOf(
    contract: Pick<Contract, "kind" | "acceptance" | "verification" | "nonGoals" | "assumedScope">,
  ) {
    return createHash("sha256")
      .update(
        JSON.stringify({
          kind: contract.kind,
          acceptance: contract.acceptance.map((item) => ({ id: item.id, text: item.text.trim() })),
          verification: contract.verification.map((item) => ({
            tag: item.tag,
            action: item.action.trim(),
            observation: item.observation.trim(),
          })),
          nonGoals: contract.nonGoals.map((item) => item.trim()),
          assumedScope: contract.assumedScope.trim(),
        }),
      )
      .digest("hex")
  }

  export function fromFields(input: {
    kind: Kind
    title?: string
    acceptance: Array<{ id?: string; text: string }>
    verification: Array<{ tag?: "gating" | "evidence"; action: string; observation: string }>
    nonGoals: string[]
    assumedScope: string
    implementationApproach?: string
    taskChecklist?: string[]
    risks?: string[]
  }): Contract {
    const acceptance = input.acceptance
      .map((item, index) => ({
        id: validAcceptanceId(item.id) ?? `AC${index + 1}`,
        text: oneLine(item.text),
      }))
      .filter((item) => item.text.length > 0)
    const verification = input.verification
      .map((item) => ({
        tag: item.tag === "evidence" ? ("evidence" as const) : ("gating" as const),
        action: oneLine(item.action),
        observation: oneLine(item.observation),
      }))
      .filter((item) => item.action.length > 0)
    const nonGoals = input.nonGoals.map((item) => oneLine(item)).filter(Boolean)
    const taskChecklist = input.taskChecklist?.map((item) => oneLine(item)).filter(Boolean)
    const contract: Contract = {
      kind: input.kind,
      title: oneLine(input.title ?? "Goal plan") || "Goal plan",
      acceptance,
      verification,
      nonGoals,
      assumedScope: oneLine(input.assumedScope),
      implementationApproach: oneLine(input.implementationApproach ?? "") || undefined,
      taskChecklist: taskChecklist && taskChecklist.length > 0 ? taskChecklist : undefined,
      risks: input.risks?.map((item) => oneLine(item)).filter(Boolean),
    }
    assertValid(contract)
    return contract
  }

  export function render(contract: Contract): string {
    assertValid(contract)
    const lines = [
      `# Plan: ${contract.title}`,
      "",
      "## Goal kind",
      contract.kind,
      "",
      "## Acceptance criteria",
      ...contract.acceptance.map((item, index) => `${index + 1}. ${item.id}: ${item.text}`),
      "",
      "## Verification plan",
      ...contract.verification.map(
        (item, index) =>
          `${index + 1}. ${item.tag}: ${escapeVerificationField(item.action)} — ${escapeVerificationField(item.observation)}`,
      ),
      "",
      "## Non-goals",
      ...contract.nonGoals.map((item) => `- ${item}`),
      "",
      "## Assumed scope",
      contract.assumedScope,
    ]
    if (contract.kind === "code-change") {
      lines.push(
        "",
        "## Implementation approach",
        contract.implementationApproach ?? "",
        "",
        "## Task checklist",
        ...(contract.taskChecklist ?? []).map((item) => `- [ ] ${item}`),
      )
    }
    if (contract.risks && contract.risks.length > 0) {
      lines.push("", "## Risks / unknowns", ...contract.risks.map((item) => `- ${item}`))
    }
    lines.push("")
    return lines.join("\n")
  }

  export function parse(markdown: string): Contract {
    assertWithinReadLimit(markdown)
    const sections = splitSections(markdown)
    const title = headline(markdown)
    const kindRaw = firstLine(sections.get("goal kind")).toLowerCase()
    if (!Kind.includes(kindRaw as Kind)) {
      throw new Error("invalid", `Goal kind must be one of ${Kind.join(", ")}`)
    }
    const kind = kindRaw as Kind
    const acceptance = parseAcceptance(sections.get("acceptance criteria") ?? "")
    const verification = parseVerification(sections.get("verification plan") ?? "")
    const nonGoals = parseBullets(sections.get("non-goals") ?? "")
    const assumedScope = (sections.get("assumed scope") ?? "").trim()
    const implementationApproach = (sections.get("implementation approach") ?? "").trim() || undefined
    const taskChecklist = parseChecklist(sections.get("task checklist") ?? "")
    const risks = parseBullets(sections.get("risks / unknowns") ?? sections.get("risks / contradictions") ?? "")
    return fromFields({
      kind,
      title,
      acceptance,
      verification,
      nonGoals,
      assumedScope,
      implementationApproach,
      taskChecklist: taskChecklist.length > 0 ? taskChecklist : undefined,
      risks: risks.length > 0 ? risks : undefined,
    })
  }

  export function firstUncheckedTask(markdown: string): string | undefined {
    const sections = splitSections(markdown)
    const body = sections.get("task checklist")
    if (!body) return undefined
    for (const line of body.split(/\r?\n/)) {
      const match = /^\s*[-*+]\s+\[ \]\s+(.+?)\s*$/.exec(line)
      if (match?.[1]) return match[1]
    }
    return undefined
  }

  type CappedReadResult =
    | { status: "found"; markdown: string }
    | { status: "missing" }
    | { status: "invalid"; error: unknown }

  function readCappedResult(file: string): CappedReadResult {
    try {
      const fd = fs.openSync(file, "r")
      try {
        const buf = Buffer.alloc(MAX_READ_BYTES + 1)
        const bytes = fs.readSync(fd, buf, 0, MAX_READ_BYTES + 1, 0)
        if (bytes <= 0) return { status: "found", markdown: "" }
        if (bytes > MAX_READ_BYTES) {
          return {
            status: "invalid",
            error: new Error("invalid", `Goal plan exceeds ${MAX_READ_BYTES} bytes`),
          }
        }
        return { status: "found", markdown: buf.subarray(0, bytes).toString("utf8") }
      } finally {
        fs.closeSync(fd)
      }
    } catch (error) {
      if (Filesystem.isMissingPathError(error)) return { status: "missing" }
      return { status: "invalid", error }
    }
  }

  export function readCapped(file: string): string | undefined {
    const result = readCappedResult(file)
    return result.status === "found" && result.markdown ? result.markdown : undefined
  }

  export function read(sessionID: SessionID, created: number): ReadResult {
    const file = pathFor(sessionID, created)
    const result = readCappedResult(file)
    if (result.status === "missing") return result
    if (result.status === "invalid") {
      log.warn("goal plan read failed", { file, error: toErrorMessage(result.error) })
      return result
    }
    const markdown = result.markdown
    if (!markdown.trim()) {
      const error = new Error("invalid", "Goal plan is empty")
      log.warn("goal plan parse failed", { file, error: error.message })
      return { status: "invalid", error }
    }
    try {
      return { status: "found", contract: parse(markdown) }
    } catch (error) {
      log.warn("goal plan parse failed", { file, error: toErrorMessage(error) })
      return { status: "invalid", error }
    }
  }

  export function storedDigest(sessionID: SessionID, created: number): string | undefined {
    try {
      const text = fs.readFileSync(digestPathFor(sessionID, created), "utf8").trim()
      return text || undefined
    } catch {
      return undefined
    }
  }

  export function hasValidContract(sessionID: SessionID, created: number): boolean {
    const result = read(sessionID, created)
    if (result.status !== "found") return false
    const stored = storedDigest(sessionID, created)
    if (!stored) return false
    return stored === digestOf(result.contract)
  }

  export function continuationGuidance(sessionID: SessionID, created: number) {
    const file = pathFor(sessionID, created)
    const markdown = readCapped(file)
    if (!markdown?.trim()) return undefined
    return {
      path: file,
      nextStep: firstUncheckedTask(markdown),
    }
  }

  export async function write(sessionID: SessionID, created: number, markdown: string) {
    const contract = parse(markdown)
    const rendered = render(contract)
    assertWithinReadLimit(rendered)
    const file = pathFor(sessionID, created)
    const digestFile = digestPathFor(sessionID, created)
    await fs.promises.mkdir(path.dirname(file), { recursive: true })
    await fs.promises.mkdir(path.dirname(digestFile), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    const digestTmp = `${digestFile}.${process.pid}.tmp`
    try {
      await fs.promises.writeFile(tmp, rendered, "utf8")
      await fs.promises.writeFile(digestTmp, digestOf(contract) + "\n", "utf8")
      // Publish the digest first so a crash can never leave a plan that looks
      // like pre-contract data and is silently replaced on resume. A lone
      // digest makes completion and resume fail closed until the plan is restored.
      await fs.promises.rename(digestTmp, digestFile)
      await fs.promises.rename(tmp, file)
    } catch (error) {
      await fs.promises.unlink(tmp).catch(() => undefined)
      await fs.promises.unlink(digestTmp).catch(() => undefined)
      throw error
    }
    return { contract, path: file }
  }

  export async function copyForFork(input: { from: SessionID; fromCreated: number; to: SessionID; toCreated: number }) {
    const fromPlan = pathFor(input.from, input.fromCreated)
    const fromDigest = digestPathFor(input.from, input.fromCreated)
    const toPlan = pathFor(input.to, input.toCreated)
    const toDigest = digestPathFor(input.to, input.toCreated)
    await fs.promises.mkdir(path.dirname(toPlan), { recursive: true })
    await fs.promises.mkdir(path.dirname(toDigest), { recursive: true })
    const suffix = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
    const planTmp = `${toPlan}.${suffix}`
    const digestTmp = `${toDigest}.${suffix}`
    let copiedPlan = false
    try {
      await fs.promises.copyFile(fromPlan, planTmp)
      copiedPlan = true
      try {
        await fs.promises.copyFile(fromDigest, digestTmp)
      } catch (error) {
        if (!Filesystem.isMissingPathError(error)) throw error
        const result = read(input.from, input.fromCreated)
        if (result.status !== "found") {
          throw new Error(
            result.status === "missing" ? "missing" : "invalid",
            "Cannot copy a goal plan without a readable source contract",
          )
        }
        await fs.promises.writeFile(digestTmp, digestOf(result.contract) + "\n", "utf8")
      }
      // Publish the digest first so a crash can never leave a target plan
      // that looks legacy and is silently replaced on resume. A lone digest
      // makes completion and resume fail closed until the plan is restored.
      await fs.promises.rename(digestTmp, toDigest)
      await fs.promises.rename(planTmp, toPlan)
    } catch (error) {
      await fs.promises.unlink(planTmp).catch(() => undefined)
      await fs.promises.unlink(digestTmp).catch(() => undefined)
      if (!copiedPlan && Filesystem.isMissingPathError(error)) return
      throw error
    }
  }

  export async function remove(sessionID: SessionID, created: number) {
    await fs.promises.unlink(pathFor(sessionID, created)).catch(() => undefined)
    await fs.promises.unlink(digestPathFor(sessionID, created)).catch(() => undefined)
  }

  export function sample(objective: string): Contract {
    const text = objective.trim() || "complete the requested work"
    return fromFields({
      kind: "code-change",
      title: text,
      acceptance: [{ text }],
      verification: [
        {
          tag: "gating",
          action: "run the relevant tests or verify_project",
          observation: "the checks pass after the last change",
        },
      ],
      nonGoals: ["unrelated refactors"],
      assumedScope: "the files implied by the objective",
      implementationApproach: "Make the smallest change that satisfies the acceptance criteria.",
      taskChecklist: ["Inspect the current code", "Implement the change", "Run verification"],
    })
  }

  function assertValid(contract: Contract) {
    if (contract.acceptance.length < 1 || contract.acceptance.length > MAX_ACCEPTANCE) {
      throw new Error("invalid", `Acceptance criteria must contain 1–${MAX_ACCEPTANCE} items`)
    }
    const ids = new Set<string>()
    for (const item of contract.acceptance) {
      if (!item.text) throw new Error("invalid", "Acceptance criteria cannot be empty")
      if (ids.has(item.id)) throw new Error("invalid", `Duplicate acceptance id ${item.id}`)
      ids.add(item.id)
    }
    if (contract.verification.length < 1) {
      throw new Error("invalid", "Verification plan must contain at least one step")
    }
    if (contract.nonGoals.length < 1) {
      throw new Error("invalid", "Non-goals must contain at least one item")
    }
    if (!contract.assumedScope) {
      throw new Error("invalid", "Assumed scope is required")
    }
    if (contract.kind === "code-change") {
      if (!contract.implementationApproach) {
        throw new Error("invalid", "code-change plans require Implementation approach")
      }
      const checklist = contract.taskChecklist ?? []
      if (checklist.length < MIN_CHECKLIST || checklist.length > MAX_CHECKLIST) {
        throw new Error("invalid", `Task checklist must contain ${MIN_CHECKLIST}–${MAX_CHECKLIST} items`)
      }
    }
  }

  function assertWithinReadLimit(markdown: string) {
    if (Buffer.byteLength(markdown, "utf8") > MAX_READ_BYTES) {
      throw new Error("invalid", `Goal plan exceeds ${MAX_READ_BYTES} bytes`)
    }
  }

  // The rendered plan format is line-based (numbered items, bullets, section
  // headers), so a field carrying an embedded newline would split across
  // lines and parse back as a different contract — silently truncating or
  // duplicating acceptance criteria, verification steps, or non-goals when
  // write() re-parses its own render output. Collapse newlines to spaces so
  // every constructed contract round-trips render -> parse unchanged.
  function oneLine(value: string): string {
    return value.replace(/\s*\r?\n+\s*/g, " ").trim()
  }

  function validAcceptanceId(id: string | undefined) {
    if (!id) return undefined
    const trimmed = id.trim().toUpperCase()
    return /^AC\d+$/.test(trimmed) ? trimmed : undefined
  }

  function headline(markdown: string) {
    const match = /^#\s+Plan:\s*(.+)$/m.exec(markdown)
    return match?.[1]?.trim() || "Goal plan"
  }

  function firstLine(body: string | undefined) {
    if (!body) return ""
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed) return trimmed
    }
    return ""
  }

  function splitSections(markdown: string) {
    const map = new Map<string, string>()
    let current: string | undefined
    const chunks: string[] = []
    const flush = () => {
      if (current) map.set(current, chunks.join("\n").trim())
    }
    for (const line of markdown.split(/\r?\n/)) {
      const header = /^#{1,6}\s+(.+?)\s*$/.exec(line)
      if (header) {
        flush()
        current = header[1].trim().toLowerCase()
        chunks.length = 0
        continue
      }
      if (current) chunks.push(line)
    }
    flush()
    return map
  }

  function parseAcceptance(body: string): Array<{ id?: string; text: string }> {
    const items: Array<{ id?: string; text: string }> = []
    for (const line of body.split(/\r?\n/)) {
      const match = /^\s*\d+\.\s+(?:(AC\d+):\s*)?(.+?)\s*$/i.exec(line)
      if (!match?.[2]) continue
      items.push({ id: match[1], text: match[2] })
    }
    return items
  }

  function parseVerification(
    body: string,
  ): Array<{ tag?: "gating" | "evidence"; action: string; observation: string }> {
    const items: Array<{ tag?: "gating" | "evidence"; action: string; observation: string }> = []
    for (const line of body.split(/\r?\n/)) {
      const match = /^\s*\d+\.\s+(?:(gating|evidence):\s*)?(.+?)\s*$/i.exec(line)
      if (!match?.[2]) continue
      const rest = match[2]
      const canonicalIndex = rest.indexOf(" — ")
      const legacy = canonicalIndex < 0 ? /\s+(?:--|–|-)\s+/.exec(rest) : undefined
      const separatorIndex = canonicalIndex >= 0 ? canonicalIndex : legacy?.index
      const separatorLength = canonicalIndex >= 0 ? " — ".length : legacy?.[0].length
      const rawAction = separatorIndex === undefined ? rest : rest.slice(0, separatorIndex)
      const rawObservation =
        separatorIndex === undefined || separatorLength === undefined
          ? rawAction
          : rest.slice(separatorIndex + separatorLength)
      const action = unescapeVerificationField(rawAction).trim()
      const observation = unescapeVerificationField(rawObservation).trim()
      const tag = match[1]?.toLowerCase() === "evidence" ? "evidence" : "gating"
      items.push({ tag, action, observation })
    }
    return items
  }

  function escapeVerificationField(value: string) {
    return value.replace(/\\/g, "\\\\").replace(/—/g, "\\—")
  }

  function unescapeVerificationField(value: string) {
    return value.replace(/\\([\\—])/g, "$1")
  }

  function parseBullets(body: string) {
    const items: string[] = []
    for (const line of body.split(/\r?\n/)) {
      const match = /^\s*[-*+]\s+(?:\[.\]\s+)?(.+?)\s*$/.exec(line)
      if (match?.[1]) items.push(match[1])
    }
    return items
  }

  function parseChecklist(body: string) {
    const items: string[] = []
    for (const line of body.split(/\r?\n/)) {
      const match = /^\s*[-*+]\s+\[.\]\s+(.+?)\s*$/.exec(line)
      if (match?.[1]) items.push(match[1])
    }
    return items
  }
}
