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

  test("scans vue and svelte files with default include patterns", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(path.join(tmp.path, "component.vue"), "<template><img src='x' /></template>")
    await fs.writeFile(path.join(tmp.path, "component.svelte"), "<img src='x' />")

    const result = await runDesignCheck([tmp.path])

    expect(result.summary.filesScanned).toBe(2)
  })

  test("skips dependency and vendor trees by default", async () => {
    await using tmp = await tmpdir()
    const vendored = path.join(tmp.path, "proj", ".venv", "lib", "python3.14", "site-packages", "mypy", "xml")
    await fs.mkdir(vendored, { recursive: true })
    await fs.writeFile(path.join(vendored, "mypy-html.css"), ".vendored { color: #000; }")
    await fs.mkdir(path.join(tmp.path, "node_modules", "pkg"), { recursive: true })
    await fs.writeFile(path.join(tmp.path, "node_modules", "pkg", "style.css"), ".dep { color: #111; }")
    await fs.mkdir(path.join(tmp.path, "vendor"), { recursive: true })
    await fs.writeFile(path.join(tmp.path, "vendor", "lib.css"), ".vendor { color: #222; }")
    await fs.mkdir(path.join(tmp.path, ".git", "objects"), { recursive: true })
    await fs.writeFile(path.join(tmp.path, ".git", "objects", "pack.css"), ".git { color: #333; }")
    await fs.writeFile(path.join(tmp.path, "app.css"), ".first-party { color: #fff; }")

    const result = await runDesignCheck([tmp.path])

    expect(result.files.map((entry) => path.basename(entry.file))).toEqual(["app.css"])
  })

  test("still scans first-party sources in ordinary subdirectories", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, "src", "views"), { recursive: true })
    await fs.writeFile(path.join(tmp.path, "src", "views", "card.tsx"), '<img src="x" />')

    const result = await runDesignCheck([tmp.path])

    expect(result.summary.filesScanned).toBe(1)
    expect(result.files.map((entry) => path.basename(entry.file))).toEqual(["card.tsx"])
  })
})
