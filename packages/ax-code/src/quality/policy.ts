import path from "path"
import * as fs from "fs/promises"
import z from "zod"
import { CategoryEnum, SeverityEnum, WorkflowEnum } from "./finding"
import { ConfigPaths } from "../config/paths"
import { Log } from "../util/log"

export const PolicyRequiredCheckSchema = z.enum(["typecheck", "lint", "test"])
export type PolicyRequiredCheck = z.infer<typeof PolicyRequiredCheckSchema>

// Phase 4 P4.3: declarative rules live in a sibling JSON file
// (.ax-code/review.rules.json or qa.rules.json), not in the markdown
// policy. This keeps prose and structured rules separate, avoids pulling
// in a YAML parser dep just for frontmatter, and lets the rule schema
// evolve via Zod validation without confusing the prose loader.
//
// All rule fields are optional. An empty rules file (or no file at all)
// means "no declarative constraints" — workflows fall back to the prose
// policy text only.
export const PolicyRulesSchema = z
  .object({
    // Categories the workflow MUST find at least one of. Surfaces as a
    // warning when none are present (does not block the workflow).
    required_categories: z.array(CategoryEnum).optional(),
    // Categories whose findings must be filtered out post-emit.
    prohibited_categories: z.array(CategoryEnum).optional(),
    // Findings below this severity are filtered out post-emit.
    // Order: CRITICAL > HIGH > MEDIUM > LOW > INFO.
    severity_floor: SeverityEnum.optional(),
    // Verification checks that must actually run for the workflow to pass.
    // This prevents a policy-sensitive review/QA run from reporting success
    // when a required runner was skipped because it was missing or disabled.
    required_checks: z.array(PolicyRequiredCheckSchema).optional(),
    // Glob patterns; only findings whose .file matches at least one
    // pattern are kept. Empty/undefined = no scope filtering.
    scope_glob: z.array(z.string().min(1)).optional(),
  })
  .strict()
export type PolicyRules = z.infer<typeof PolicyRulesSchema>

export namespace Policy {
  const log = Log.create({ service: "quality.policy" })

  // Phase 4 P4.1/P4.2: locate `.ax-code/review.md` and `.ax-code/qa.md` with
  // workspace-first precedence per the Phase 0 contract:
  //   workspace (.ax-code walk up from cwd to worktree) > user (~/.ax-code/)
  //
  // Directory discovery is centralized in ConfigPaths.policyDirectories so
  // policy files inherit the same project-config disable switch and `.ax-code`
  // namespace discipline as the rest of the configuration system, while still
  // preserving policy-specific nearest-first precedence.
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

  export async function loadReviewRules(input: { worktree: string; cwd?: string }): Promise<PolicyRules | undefined> {
    return loadRulesByName({ ...input, name: "review.rules.json" })
  }

  export async function loadQaRules(input: { worktree: string; cwd?: string }): Promise<PolicyRules | undefined> {
    return loadRulesByName({ ...input, name: "qa.rules.json" })
  }

  export async function loadWorkflowRules(input: {
    workflow: z.infer<typeof WorkflowEnum>
    worktree: string
    cwd?: string
  }): Promise<PolicyRules | undefined> {
    if (input.workflow === "review") return loadReviewRules(input)
    if (input.workflow === "qa") return loadQaRules(input)
    return undefined
  }

  export async function loadWorkflowPolicy(input: {
    workflow: z.infer<typeof WorkflowEnum>
    worktree: string
    cwd?: string
  }): Promise<string | undefined> {
    if (input.workflow === "review") return loadReviewPolicy(input)
    if (input.workflow === "qa") return loadQaPolicy(input)
    return undefined
  }

  function assertSafePolicyName(name: string) {
    if (path.basename(name) !== name || name.includes("/") || name.includes("\\")) {
      throw new Error(`Invalid policy name: "${name}"`)
    }
  }

  async function loadRulesByName(input: {
    worktree: string
    cwd?: string
    name: string
  }): Promise<PolicyRules | undefined> {
    assertSafePolicyName(input.name)
    const cwd = input.cwd ?? input.worktree
    for await (const dir of policyDirs({ worktree: input.worktree, cwd })) {
      const candidate = path.join(dir, input.name)
      let raw: string
      try {
        raw = await fs.readFile(candidate, "utf8")
      } catch (err) {
        const code = (err as NodeJS.ErrnoException | undefined)?.code
        if (code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR") continue
        log.warn("rules read failed; skipping", { name: input.name, path: candidate, err })
        continue
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (err) {
        log.warn("rules JSON parse failed; treating as missing", {
          name: input.name,
          path: candidate,
          err: err instanceof Error ? err.message : String(err),
        })
        return undefined
      }
      const validated = PolicyRulesSchema.safeParse(parsed)
      if (!validated.success) {
        log.warn("rules schema validation failed; treating as missing", {
          name: input.name,
          path: candidate,
          issues: validated.error.issues.length,
        })
        return undefined
      }
      log.info("loaded rules", { name: input.name, path: candidate })
      return validated.data
    }
    return undefined
  }

  async function* policyDirs(input: { worktree: string; cwd: string }): AsyncGenerator<string> {
    yield* await ConfigPaths.policyDirectories(input.cwd, input.worktree)
  }

  async function loadByName(input: { worktree: string; cwd?: string; name: string }): Promise<string | undefined> {
    assertSafePolicyName(input.name)
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
