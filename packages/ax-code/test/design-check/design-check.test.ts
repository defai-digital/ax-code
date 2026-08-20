import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "vitest"
import { runDesignCheck } from "../../src/design-check"
import { tmpdir } from "../fixture/fixture"

describe("design check", () => {
  test("honors include and ignore patterns", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(path.join(tmp.path, "visible.css"), ".visible { color: #fff; }")
    await fs.writeFile(path.join(tmp.path, "excluded.tsx"), '<img src="x" />')
    await fs.mkdir(path.join(tmp.path, "generated"))
    await fs.writeFile(path.join(tmp.path, "generated", "ignored.css"), ".ignored { color: #000; }")

    const result = await runDesignCheck([tmp.path], {
      include: ["**/*.css"],
      ignore: ["generated"],
    })

    expect(result.summary.filesScanned).toBe(1)
    expect(result.files.map((entry) => path.basename(entry.file))).toEqual(["visible.css"])
  })

  test("rejects unknown rules and invalid severities", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(path.join(tmp.path, "view.tsx"), "export const View = () => null")

    await expect(runDesignCheck([tmp.path], { rules: { unknown: "warn" } as any })).rejects.toThrow(
      "Unknown design-check rule: unknown",
    )
    await expect(runDesignCheck([tmp.path], { rules: { "missing-alt-text": "fatal" } as any })).rejects.toThrow(
      "Invalid severity for missing-alt-text: fatal",
    )
  })

  test("surfaces missing scan paths instead of reporting a clean result", async () => {
    await using tmp = await tmpdir()
    await expect(runDesignCheck([path.join(tmp.path, "missing")])).rejects.toMatchObject({ code: "ENOENT" })
  })
})
