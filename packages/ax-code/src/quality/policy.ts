import path from "path"
import * as fs from "fs/promises"
import { ConfigPaths } from "../config/paths"
import { Log } from "../util/log"

export namespace Policy {
  const log = Log.create({ service: "quality.policy" })

  // Phase 4 P4.1/P4.2: locate `.ax-code/review.md` and `.ax-code/qa.md` using
  // the same precedence-walked directory list as the rest of ax-code's config
  // (ConfigPaths.directories). Only the most-specific match wins in v1 —
  // concatenation across levels (workspace + user + global) is a future slice
  // once we have a real consumer that needs additive policy.
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

  async function loadByName(input: { worktree: string; cwd?: string; name: string }): Promise<string | undefined> {
    const cwd = input.cwd ?? input.worktree
    const dirs = await ConfigPaths.directories(cwd, input.worktree)
    for (const dir of dirs) {
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
