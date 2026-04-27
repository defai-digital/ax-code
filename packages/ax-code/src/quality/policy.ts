import path from "path"
import * as fs from "fs/promises"
import { Filesystem } from "../util/filesystem"
import { Global } from "../global"
import { Log } from "../util/log"

export namespace Policy {
  const log = Log.create({ service: "quality.policy" })

  // Phase 4 P4.1/P4.2: locate `.ax-code/review.md` and `.ax-code/qa.md` with
  // workspace-first precedence per the Phase 0 contract:
  //   workspace (.ax-code walk up from cwd to worktree) > user (~/.ax-code/)
  //
  // We do NOT reuse `ConfigPaths.directories` because that helper is built
  // for ax-code.json config (where global is the base and project overrides),
  // and its iteration order puts `Global.Path.config` first. For policy files
  // we want most-specific-wins, the inverse precedence. Mixing the two
  // semantics caused user-global review.md to win over project — fixed here.
  //
  // Files are intentionally loaded ONLY when the matching workflow is
  // invoked (per Phase 0 contract) — there is no eager bootstrap. Callers
  // pass a worktree and get the loaded text or undefined.

  export async function loadReviewPolicy(input: { worktree: string; cwd?: string }): Promise<string | undefined> {
    return loadByName({ ...input, name: "review.md" })
  }

  export async function loadQaPolicy(input: { worktree: string; cwd?: string }): Promise<string | undefined> {
    return loadByName({ ...input, name: "qa.md" })
  }

  async function* policyDirs(input: { worktree: string; cwd: string }): AsyncGenerator<string> {
    // 1. Project: .ax-code dirs walking up from cwd, stopping at worktree.
    //    Filesystem.up yields nearest-first, which is the precedence we want.
    yield* Filesystem.up({ targets: [".ax-code"], start: input.cwd, stop: input.worktree })
    // 2. User-home: ~/.ax-code (single-level check).
    yield* Filesystem.up({ targets: [".ax-code"], start: Global.Path.home, stop: Global.Path.home })
  }

  async function loadByName(input: { worktree: string; cwd?: string; name: string }): Promise<string | undefined> {
    const cwd = input.cwd ?? input.worktree
    for await (const dir of policyDirs({ worktree: input.worktree, cwd })) {
      const candidate = path.join(dir, input.name)
      try {
        const text = await fs.readFile(candidate, "utf8")
        log.info("loaded policy", { name: input.name, path: candidate, bytes: text.length })
        return text
      } catch (err) {
        const code = (err as NodeJS.ErrnoException | undefined)?.code
        if (code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR") continue
        // Surface unexpected read errors but don't block — policy is opt-in,
        // so missing/broken policy must never abort a workflow.
        log.warn("policy read failed; skipping", { name: input.name, path: candidate, err })
      }
    }
    return undefined
  }
}
