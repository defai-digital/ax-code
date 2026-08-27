import { createHash } from "node:crypto"
import fs from "fs"
import path from "path"
import { Global } from "../global"
import { Instance } from "../project/instance"
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
        text: item.text.trim(),
      }))
      .filter((item) => item.text.length > 0)
    const verification = input.verification
      .map((item) => ({
        tag: item.tag === "evidence" ? ("evidence" as const) : ("gating" as const),
        action: item.action.trim(),
        observation: item.observation.trim(),
      }))
      .filter((item) => item.action.length > 0)
    const nonGoals = input.nonGoals.map((item) => item.trim()).filter(Boolean)
    const taskChecklist = input.taskChecklist?.map((item) => item.trim()).filter(Boolean)
    const contract: Contract = {
      kind: input.kind,
      title: (input.title ?? "Goal plan").trim() || "Goal plan",
      acceptance,
      verification,
      nonGoals,
      assumedScope: input.assumedScope.trim(),
      implementationApproach: input.implementationApproach?.trim() || undefined,
      taskChecklist: taskChecklist && taskChecklist.length > 0 ? taskChecklist : undefined,
      risks: input.risks?.map((item) => item.trim()).filter(Boolean),
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
      ...contract.verification.map((item, index) => `${index + 1}. ${item.tag}: ${item.action} — ${item.observation}`),
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
    if (markdown.length > MAX_READ_BYTES) {
      throw new Error("invalid", `Goal plan exceeds ${MAX_READ_BYTES} bytes`)
    }
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

  export function readCapped(file: string): string | undefined {
    try {
      const fd = fs.openSync(file, "r")
      try {
        const buf = Buffer.alloc(MAX_READ_BYTES)
        const bytes = fs.readSync(fd, buf, 0, MAX_READ_BYTES, 0)
        if (bytes <= 0) return undefined
        let slice = buf.subarray(0, bytes)
        if (bytes >= MAX_READ_BYTES) {
          const lastNl = slice.lastIndexOf(0x0a)
          if (lastNl >= 0) slice = slice.subarray(0, lastNl)
        }
        return slice.toString("utf8")
      } finally {
        fs.closeSync(fd)
      }
    } catch {
      return undefined
    }
  }

  export function read(sessionID: SessionID, created: number): Contract | undefined {
    const file = pathFor(sessionID, created)
    const markdown = readCapped(file)
    if (!markdown?.trim()) return undefined
    try {
      return parse(markdown)
    } catch (error) {
      log.warn("goal plan parse failed", { file, error: toErrorMessage(error) })
      return undefined
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
    const contract = read(sessionID, created)
    if (!contract) return false
    const stored = storedDigest(sessionID, created)
    if (!stored) return false
    return stored === digestOf(contract)
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
    const file = pathFor(sessionID, created)
    const digestFile = digestPathFor(sessionID, created)
    await fs.promises.mkdir(path.dirname(file), { recursive: true })
    await fs.promises.mkdir(path.dirname(digestFile), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    const digestTmp = `${digestFile}.${process.pid}.tmp`
    await fs.promises.writeFile(tmp, render(contract), "utf8")
    await fs.promises.writeFile(digestTmp, digestOf(contract) + "\n", "utf8")
    await fs.promises.rename(tmp, file)
    await fs.promises.rename(digestTmp, digestFile)
    return { contract, path: file }
  }

  export async function copyForFork(input: { from: SessionID; fromCreated: number; to: SessionID; toCreated: number }) {
    const markdown = readCapped(pathFor(input.from, input.fromCreated))
    if (!markdown?.trim()) return
    await write(input.to, input.toCreated, markdown)
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
      const split = rest.split(/\s+[—–-]\s+|\s+--\s+/)
      const action = (split[0] ?? rest).trim()
      const observation = (split.slice(1).join(" — ") || action).trim()
      const tag = match[1]?.toLowerCase() === "evidence" ? "evidence" : "gating"
      items.push({ tag, action, observation })
    }
    return items
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
