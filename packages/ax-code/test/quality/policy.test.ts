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
})
