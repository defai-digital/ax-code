import { describe, expect, test } from "bun:test"
import * as fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Policy } from "../../src/quality/policy"
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
