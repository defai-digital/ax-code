import { describe, expect, it } from "vitest"
import fsPromises from "fs/promises"
import os from "os"
import path from "path"
import {
  ensureDir,
  getTargetSkillDir,
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
