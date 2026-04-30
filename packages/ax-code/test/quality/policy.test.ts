import { describe, expect, test } from "bun:test"
import * as fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Policy, type PolicyRules } from "../../src/quality/policy"
import { tmpdir } from "../fixture/fixture"

async function writeFile(dir: string, relPath: string, contents: string) {
  const full = path.join(dir, relPath)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, contents, "utf8")
}

describe("Policy.loadReviewPolicy", () => {
  test("returns undefined when no .ax-code/review.md exists anywhere on the search path", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const policy = await Policy.loadReviewPolicy({ worktree: tmp.path })
        expect(policy).toBeUndefined()
      },
    })
  })

  test("loads .ax-code/review.md from the project root", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeFile(
      tmp.path,
      ".ax-code/review.md",
      "# Project review rules\n\nReject any change to src/auth/ without two reviewers.\n",
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const policy = await Policy.loadReviewPolicy({ worktree: tmp.path })
        expect(policy).toBeDefined()
        expect(policy).toContain("Reject any change to src/auth/")
      },
    })
  })

  test("does not pick up qa.md when asked for review.md", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeFile(tmp.path, ".ax-code/qa.md", "# QA rules only\n")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const policy = await Policy.loadReviewPolicy({ worktree: tmp.path })
        expect(policy).toBeUndefined()
      },
    })
  })
})

describe("Policy.loadQaPolicy", () => {
  test("returns undefined when no .ax-code/qa.md exists", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const policy = await Policy.loadQaPolicy({ worktree: tmp.path })
        expect(policy).toBeUndefined()
      },
    })
  })

  test("loads .ax-code/qa.md from the project root", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeFile(tmp.path, ".ax-code/qa.md", "# QA rules\n\nAlways run typecheck before merge.\n")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const policy = await Policy.loadQaPolicy({ worktree: tmp.path })
        expect(policy).toBeDefined()
        expect(policy).toContain("Always run typecheck before merge")
      },
    })
  })

  test("does not pick up review.md when asked for qa.md", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeFile(tmp.path, ".ax-code/review.md", "# Review rules only\n")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const policy = await Policy.loadQaPolicy({ worktree: tmp.path })
        expect(policy).toBeUndefined()
      },
    })
  })

  test("review and qa policies are isolated even when both files exist", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeFile(tmp.path, ".ax-code/review.md", "REVIEW_ONLY_TOKEN")
    await writeFile(tmp.path, ".ax-code/qa.md", "QA_ONLY_TOKEN")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const review = await Policy.loadReviewPolicy({ worktree: tmp.path })
        const qa = await Policy.loadQaPolicy({ worktree: tmp.path })
        expect(review).toContain("REVIEW_ONLY_TOKEN")
        expect(review).not.toContain("QA_ONLY_TOKEN")
        expect(qa).toContain("QA_ONLY_TOKEN")
        expect(qa).not.toContain("REVIEW_ONLY_TOKEN")
      },
    })
  })

  test("policy files outside .ax-code/ are not loaded (namespace discipline)", async () => {
    await using tmp = await tmpdir({ git: true })
    // a stray review.md at the repo root must NOT be picked up
    await writeFile(tmp.path, "review.md", "# stray top-level file\n")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const policy = await Policy.loadReviewPolicy({ worktree: tmp.path })
        expect(policy).toBeUndefined()
      },
    })
  })

  test("workspace .ax-code/review.md precedence: nearest dir wins over a parent", async () => {
    await using tmp = await tmpdir({ git: true })
    // Place a review.md at the worktree root AND inside a nested package dir.
    // Walking up from the nested dir (cwd) should hit the nested one first.
    await writeFile(tmp.path, ".ax-code/review.md", "# root policy\nROOT_TOKEN")
    await writeFile(tmp.path, "packages/inner/.ax-code/review.md", "# nested policy\nNESTED_TOKEN")
    const inner = path.join(tmp.path, "packages", "inner")
    await Instance.provide({
      directory: inner,
      fn: async () => {
        const policy = await Policy.loadReviewPolicy({ worktree: tmp.path, cwd: inner })
        expect(policy).toBeDefined()
        expect(policy).toContain("NESTED_TOKEN")
        expect(policy).not.toContain("ROOT_TOKEN")
      },
    })
  })

  test("policy content with $&, $1, $$ survives the review template substitution verbatim", async () => {
    // Regression for a String.replace special-pattern bug — see
    // src/command/index.ts. Without the fix, a policy that mentions e.g.
    // "$1 was injected" would get the substitution pattern interpreted by
    // String.prototype.replace and emit garbled output.
    await using tmp = await tmpdir({ git: true })
    const policy = "Block any commit message containing $&, $1, or $$ literally."
    await writeFile(tmp.path, ".ax-code/review.md", policy)

    // Re-implement the substitution path manually to keep the test
    // hermetic (avoid loading the full Command service / Effect layer).
    const PROMPT_REVIEW = "before ${review_policy} after"
    const loaded = await Instance.provide({
      directory: tmp.path,
      fn: () => Policy.loadReviewPolicy({ worktree: tmp.path }),
    })
    const text = (loaded ?? "").trim()
    const rendered = PROMPT_REVIEW.replace("${review_policy}", () => text)
    expect(rendered).toContain("$&")
    expect(rendered).toContain("$1")
    expect(rendered).toContain("$$")
    expect(rendered).toBe(`before ${text} after`)
  })

  test("falls back to a parent .ax-code/review.md when the nearest dir has none", async () => {
    await using tmp = await tmpdir({ git: true })
    // Only the worktree root has the policy file; the nested cwd does not.
    await writeFile(tmp.path, ".ax-code/review.md", "ROOT_ONLY_POLICY")
    const inner = path.join(tmp.path, "packages", "inner")
    await fs.mkdir(inner, { recursive: true })
    await Instance.provide({
      directory: inner,
      fn: async () => {
        const policy = await Policy.loadReviewPolicy({ worktree: tmp.path, cwd: inner })
        expect(policy).toContain("ROOT_ONLY_POLICY")
      },
    })
  })
})

describe("Policy.loadReviewRules / loadQaRules", () => {
  test("returns undefined when no rules file exists", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await Policy.loadReviewRules({ worktree: tmp.path })).toBeUndefined()
        expect(await Policy.loadQaRules({ worktree: tmp.path })).toBeUndefined()
      },
    })
  })

  test("loads and validates a complete review.rules.json", async () => {
    await using tmp = await tmpdir({ git: true })
    const rules: PolicyRules = {
      required_categories: ["bug", "security"],
      prohibited_categories: ["regression_risk"],
      severity_floor: "MEDIUM",
      required_checks: ["typecheck", "test"],
      scope_glob: ["src/**", "test/**"],
    }
    await writeFile(tmp.path, ".ax-code/review.rules.json", JSON.stringify(rules))
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const loaded = await Policy.loadReviewRules({ worktree: tmp.path })
        expect(loaded).toEqual(rules)
      },
    })
  })

  test("returns undefined for malformed JSON without throwing", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeFile(tmp.path, ".ax-code/review.rules.json", "{ not valid json")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await Policy.loadReviewRules({ worktree: tmp.path })).toBeUndefined()
      },
    })
  })

  test("returns undefined when rules fail schema validation (unknown field)", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeFile(tmp.path, ".ax-code/review.rules.json", JSON.stringify({ unknown_field: "x" }))
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // strict() schema rejects unknown keys
        expect(await Policy.loadReviewRules({ worktree: tmp.path })).toBeUndefined()
      },
    })
  })

  test("review and qa rules files are isolated", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeFile(tmp.path, ".ax-code/review.rules.json", JSON.stringify({ severity_floor: "HIGH" }))
    await writeFile(tmp.path, ".ax-code/qa.rules.json", JSON.stringify({ severity_floor: "LOW" }))
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const r = await Policy.loadReviewRules({ worktree: tmp.path })
        const q = await Policy.loadQaRules({ worktree: tmp.path })
        expect(r?.severity_floor).toBe("HIGH")
        expect(q?.severity_floor).toBe("LOW")
      },
    })
  })

  test("workflow rules load only review and qa policies", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeFile(tmp.path, ".ax-code/review.rules.json", JSON.stringify({ required_checks: ["typecheck"] }))
    await writeFile(tmp.path, ".ax-code/qa.rules.json", JSON.stringify({ required_checks: ["test"] }))
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await Policy.loadWorkflowRules({ workflow: "review", worktree: tmp.path })).toEqual({
          required_checks: ["typecheck"],
        })
        expect(await Policy.loadWorkflowRules({ workflow: "qa", worktree: tmp.path })).toEqual({
          required_checks: ["test"],
        })
        expect(await Policy.loadWorkflowRules({ workflow: "debug", worktree: tmp.path })).toBeUndefined()
      },
    })
  })

  test("rules and prose are loaded independently — having rules.json without review.md works", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeFile(tmp.path, ".ax-code/review.rules.json", JSON.stringify({ severity_floor: "MEDIUM" }))
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await Policy.loadReviewPolicy({ worktree: tmp.path })).toBeUndefined()
        const rules = await Policy.loadReviewRules({ worktree: tmp.path })
        expect(rules?.severity_floor).toBe("MEDIUM")
      },
    })
  })
})
