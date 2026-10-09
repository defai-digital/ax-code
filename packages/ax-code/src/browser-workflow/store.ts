import fs from "node:fs/promises"
import { constants } from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { Instance } from "../project/instance"
import type { SessionID } from "../session/schema"
import { git } from "../util/git"
import { BrowserScenario } from "./scenario"
import { BrowserRunner } from "./runner"

export namespace BrowserWorkflowStore {
  type State = { scenarios: Map<string, BrowserScenario.Frozen>; receipts: BrowserRunner.Receipt[] }
  const state = Instance.state(() => new Map<SessionID, State>())
  function session(id: SessionID): State {
    let value = state().get(id)
    if (!value) {
      if (state().size >= 128) throw new Error("Browser workflow session limit reached")
      value = { scenarios: new Map(), receipts: [] }
      state().set(id, value)
    }
    return value
  }
  export async function identity(cwd = Instance.worktree): Promise<BrowserScenario.Identity> {
    const root = await git(["rev-parse", "--show-toplevel"], { cwd, timeout: 5000 })
    if (root.exitCode !== 0) throw new Error("Cannot locate browser evidence repository")
    cwd = root.text().trim()
    const [head, tracked, untracked] = await Promise.all([
      git(["rev-parse", "HEAD"], { cwd, timeout: 5000 }),
      git(["diff", "--no-ext-diff", "--binary", "HEAD", "--"], { cwd, timeout: 5000 }),
      git(["ls-files", "--others", "--exclude-standard", "-z"], { cwd, timeout: 5000 }),
    ])
    if ([head, tracked, untracked].some((item) => item.exitCode !== 0 || item.stdout.length > 16 * 1024 * 1024))
      throw new Error("Cannot bind browser evidence to repository content")
    const revision = head.text().trim()
    const hash = createHash("sha256").update(revision).update("\0").update(tracked.stdout)
    const files = untracked.text().split("\0").filter(Boolean).sort()
    if (files.length > 1000) throw new Error("Too many untracked files for browser evidence")
    let bytes = tracked.stdout.length
    for (const file of files) {
      if (path.isAbsolute(file) || file.split(/[\\/]/).includes(".."))
        throw new Error("Invalid repository-relative path")
      // @scan-suppress security_scan - git supplies relative paths; absolute and traversal components are rejected above; O_NOFOLLOW rejects symlink files.
      const target = path.resolve(cwd, file)
      const handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const stat = await handle.stat()
        if (!stat.isFile() || stat.size > 1024 * 1024 || (bytes += stat.size) > 16 * 1024 * 1024)
          throw new Error("Unsupported untracked file in browser evidence")
        const buffer = Buffer.alloc(1024 * 1024 + 1)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        const content = buffer.subarray(0, bytesRead)
        if (content.length !== stat.size) throw new Error("Untracked file changed while binding evidence")
        hash.update("\0").update(file).update("\0").update(String(stat.mode)).update("\0").update(content)
      } finally {
        await handle.close()
      }
    }
    return { revision, tree: hash.digest("hex") }
  }
  export function put(id: SessionID, frozen: BrowserScenario.Frozen): string {
    const value = session(id)
    if (value.scenarios.size >= 32 && !value.scenarios.has(frozen.hash))
      throw new Error("Browser scenario limit reached")
    BrowserScenario.Manifest.parse(frozen.manifest)
    if (frozen.runner !== BrowserScenario.VERSION) throw new Error("Unsupported browser runner version")
    const { hash, ...body } = frozen
    if (BrowserScenario.digest(body) !== hash) throw new Error("Frozen scenario hash mismatch")
    value.scenarios.set(hash, structuredClone(frozen))
    return hash
  }
  export function get(id: SessionID, hash: string): BrowserScenario.Frozen {
    const value = state().get(id)?.scenarios.get(hash)
    if (!value) throw new Error("Unknown frozen scenario in this session; freeze before editing")
    return structuredClone(value)
  }
  export function record(id: SessionID, receipt: BrowserRunner.Receipt): void {
    if (!BrowserRunner.authentic(receipt)) throw new Error("Browser receipt was not issued intact by this runtime")
    const value = session(id)
    if (!value.scenarios.has(receipt.scenarioHash)) throw new Error("Receipt has no frozen scenario")
    if (value.receipts.some((entry) => entry.id === receipt.id)) throw new Error("Browser receipt already recorded")
    const matching = value.receipts.filter((entry) => entry.scenarioHash === receipt.scenarioHash)
    if (matching.length >= 16) value.receipts.splice(value.receipts.indexOf(matching[0]!), 1)
    value.receipts.push(structuredClone(receipt))
  }
  export function receipts(id: SessionID, hash: string): BrowserRunner.Receipt[] {
    return structuredClone(
      state()
        .get(id)
        ?.receipts.filter((receipt) => receipt.scenarioHash === hash) ?? [],
    )
  }
  export function control(id: SessionID, hash: string, baseline: BrowserScenario.Identity): BrowserScenario.Frozen {
    const frozen = get(id, hash)
    if (frozen.baseline.revision !== baseline.revision || frozen.baseline.tree !== baseline.tree)
      throw new Error("Arena browser scenario must be frozen on the current clean base")
    const found = receipts(id, hash).some(
      (receipt) =>
        receipt.status === "fail" &&
        receipt.cleanup &&
        receipt.diagnostics.complete &&
        receipt.identity.tree === baseline.tree &&
        receipt.identity.revision === baseline.revision &&
        receipt.steps.some(
          (step) =>
            step.status === "fail" &&
            frozen.manifest.steps[step.index]?.action === "assert" &&
            step.reason === "Structured assertion differed",
        ),
    )
    if (!found)
      throw new Error(
        "Arena requires an observed failing assertion on the frozen base; missing, canceled and unknown controls do not qualify",
      )
    return frozen
  }
  export async function qualify(id: SessionID, hash: string): Promise<boolean> {
    const frozen = get(id, hash)
    return qualifies(receipts(id, hash), frozen, await identity())
  }
  export async function admitControl(id: SessionID, hash: string): Promise<BrowserScenario.Frozen> {
    const status = await git(["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: Instance.worktree,
      timeout: 5000,
    })
    if (status.exitCode !== 0 || status.stdout.length > 0)
      throw new Error("Arena browser control requires a clean repository")
    return control(id, hash, await identity())
  }
  export function qualifies(
    receipts: BrowserRunner.Receipt[],
    frozen: BrowserScenario.Frozen,
    identity: BrowserScenario.Identity,
  ): boolean {
    const last = receipts.slice(-2)
    return (
      last.length === 2 &&
      new Set(last.map((receipt) => receipt.id)).size === 2 &&
      last.every(
        (receipt) =>
          receipt.scenarioHash === frozen.hash &&
          receipt.runner === frozen.runner &&
          receipt.bridge === frozen.bridge &&
          receipt.identity.tree === identity.tree &&
          receipt.identity.revision === identity.revision &&
          receipt.status === "pass" &&
          receipt.cleanup &&
          receipt.diagnostics.complete &&
          receipt.steps.length === frozen.manifest.steps.length &&
          receipt.steps.every((step) => step.status === "pass"),
      )
    )
  }
}
