import { describe, expect, it } from "vitest"
import fsPromises from "fs/promises"
import os from "os"
import path from "path"
import {
  ensureDir,
  getCatalogItemFromSkillDocument,
  getTargetSkillDir,
  hasNonEnglishText,
  isEnglishOnlyCatalogItem,
  isRepoPathInside,
  normalizeRepoRelativePath,
  normalizeUserSkillDir,
  safeRm,
  toRepoFsPath,
  validateSkillName,
} from "./shared.js"

describe("skills-catalog shared helpers", () => {
  it("validates canonical skill names", () => {
    expect(validateSkillName("review-code")).toBe(true)
    expect(validateSkillName("a")).toBe(true)
    expect(validateSkillName("-bad")).toBe(false)
    expect(validateSkillName("bad-")).toBe(false)
    expect(validateSkillName("Bad")).toBe(false)
    expect(validateSkillName("a".repeat(65))).toBe(false)
  })

  it("detects non-English catalog text", () => {
    expect(hasNonEnglishText("Review code and write tests")).toBe(false)
    expect(hasNonEnglishText("Review code — write tests")).toBe(false)
    expect(hasNonEnglishText("\u4ee3\u7801\u5ba1\u67e5")).toBe(true)
    expect(hasNonEnglishText("\u30ec\u30d3\u30e5\u30fc")).toBe(true)
    expect(hasNonEnglishText("\ucf54\ub4dc \ub9ac\ubdf0")).toBe(true)
  })

  it("accepts only English-only catalog items", () => {
    expect(
      isEnglishOnlyCatalogItem({
        skillName: "review-code",
        frontmatterName: "Review Code",
        description: "Review code and suggest focused fixes.",
        clawdhub: { displayName: "Review Code", owner: "team-alpha" },
      }),
    ).toBe(true)

    expect(
      isEnglishOnlyCatalogItem({
        skillName: "review-code",
        frontmatterName: "Review Code | \u4ee3\u7801\u5ba1\u67e5",
        description: "Review code and suggest focused fixes.",
      }),
    ).toBe(false)
  })

  it("normalizes repository-relative POSIX paths", () => {
    expect(normalizeRepoRelativePath("/skills//review-code/")).toBe("skills/review-code")
    expect(normalizeRepoRelativePath("skills/../review-code")).toBeNull()
    expect(normalizeRepoRelativePath("skills\\review-code")).toBeNull()
    expect(normalizeRepoRelativePath("")).toBeNull()
  })

  it("checks repository path containment without sibling prefix matches", () => {
    expect(isRepoPathInside("skills/review-code", "skills")).toBe(true)
    expect(isRepoPathInside("skills/review-code", "skills/review-code")).toBe(true)
    expect(isRepoPathInside("skills-other/review-code", "skills")).toBe(false)
    expect(isRepoPathInside("../skills/review-code", "skills")).toBe(false)
  })

  it("builds catalog items from SKILL.md frontmatter", () => {
    const item = getCatalogItemFromSkillDocument({
      source: "owner/repo",
      effectiveSubpath: "skills",
      skillDir: "skills/review-code",
      skillMdContent: "---\nname: Review Code\ndescription: Review code and suggest focused fixes.\n---\nBody\n",
    })

    expect(item).toMatchObject({
      repoSource: "owner/repo",
      repoSubpath: "skills",
      skillDir: "skills/review-code",
      skillName: "review-code",
      frontmatterName: "Review Code",
      description: "Review code and suggest focused fixes.",
      installable: true,
    })
  })

  it("marks non-English catalog metadata as not installable", () => {
    const item = getCatalogItemFromSkillDocument({
      source: "owner/repo",
      effectiveSubpath: "skills",
      skillDir: "skills/review-code",
      skillMdContent: "---\nname: \"Review Code | \\u4ee3\\u7801\\u5ba1\\u67e5\"\n---\nBody\n",
    })

    expect(item.installable).toBe(false)
    expect(item.warnings).toContain("Skill catalog metadata must be English-only")
  })

  it("normalizes the legacy default user skill dir to the plural path", () => {
    const legacyDir = path.join(os.homedir(), ".config", "ax-code", "skill")
    const pluralDir = path.join(os.homedir(), ".config", "ax-code", "skills")

    if (!path.isAbsolute(legacyDir)) {
      throw new Error("Expected absolute home directory")
    }

    const normalized = normalizeUserSkillDir(legacyDir)
    expect([legacyDir, pluralDir]).toContain(normalized)
  })

  it("resolves target directories by scope and source", () => {
    const userSkillDir = path.join(os.tmpdir(), "oc-user-skills")
    const workingDirectory = path.join(os.tmpdir(), "oc-project")

    expect(
      getTargetSkillDir({
        scope: "user",
        targetSource: "ax-code",
        userSkillDir,
        skillName: "review-code",
      }),
    ).toBe(path.join(userSkillDir, "review-code"))

    expect(
      getTargetSkillDir({
        scope: "project",
        targetSource: "agents",
        workingDirectory,
        userSkillDir,
        skillName: "review-code",
      }),
    ).toBe(path.join(workingDirectory, ".agents", "skills", "review-code"))
  })

  it("converts repo POSIX paths to local filesystem paths", () => {
    expect(toRepoFsPath("/tmp/repo", "skills/review-code/SKILL.md")).toBe(
      path.join("/tmp/repo", "skills", "review-code", "SKILL.md"),
    )
    expect(toRepoFsPath("/tmp/repo", "/skills//review-code/")).toBe(path.join("/tmp/repo", "skills", "review-code"))
    expect(() => toRepoFsPath("/tmp/repo", "../review-code")).toThrow("Invalid repository path")
  })

  it("creates and removes directories idempotently", async () => {
    const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "oc-skill-shared-"))
    const nestedDir = path.join(tempRoot, "a", "b")

    await ensureDir(nestedDir)
    expect((await fsPromises.stat(nestedDir)).isDirectory()).toBe(true)

    await safeRm(tempRoot)
    await expect(fsPromises.stat(tempRoot)).rejects.toMatchObject({ code: "ENOENT" })
    await safeRm(tempRoot)
  })
})
