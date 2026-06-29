import { beforeEach, describe, expect, test, vi } from "vitest"
import AdmZip from "adm-zip"
import fsPromises from "fs/promises"
import os from "os"
import path from "path"

vi.mock("./api.js", () => ({
  downloadClawdHubSkill: vi.fn(),
  fetchClawdHubSkillInfo: vi.fn(),
}))

const { downloadClawdHubSkill } = await import("./api.js")
const { installSkillsFromClawdHub, validateClawdHubZipEntries } = await import("./install.js")

const zipWithFiles = (files) => {
  const zip = new AdmZip()
  for (const [entryName, content] of Object.entries(files)) {
    zip.addFile(entryName, Buffer.from(content))
  }
  return zip.toBuffer()
}

describe("ClawdHub skill installation", () => {
  beforeEach(() => {
    downloadClawdHubSkill.mockReset()
  })

  test("skips downloaded skills with non-English catalog metadata", async () => {
    const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "clawdhub-install-test-"))
    try {
      downloadClawdHubSkill.mockResolvedValueOnce(
        zipWithFiles({
          "SKILL.md": "---\nname: \"Review Code | \\u4ee3\\u7801\\u5ba1\\u67e5\"\ndescription: Review code.\n---\n",
        }),
      )

      const result = await installSkillsFromClawdHub({
        scope: "user",
        targetSource: "ax-code",
        userSkillDir: tempRoot,
        selections: [{ skillDir: "review-code", clawdhub: { slug: "review-code", version: "1.0.0" } }],
      })

      expect(result).toMatchObject({
        ok: true,
        installed: [],
        skipped: [{ skillName: "review-code", reason: "Skill catalog metadata must be English-only" }],
      })
      await expect(fsPromises.stat(path.join(tempRoot, "review-code"))).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await fsPromises.rm(tempRoot, { recursive: true, force: true })
    }
  })

  test("rejects unsafe ZIP entry paths before extraction", () => {
    expect(
      validateClawdHubZipEntries({
        getEntries: () => [{ entryName: "SKILL.md" }, { entryName: "references/example.md" }],
      }),
    ).toEqual({ ok: true })

    expect(
      validateClawdHubZipEntries({
        getEntries: () => [{ entryName: "SKILL.md" }, { entryName: "..\\outside.txt" }],
      }),
    ).toEqual({ ok: false, reason: "Invalid ZIP entry path: ..\\outside.txt" })
  })
})
