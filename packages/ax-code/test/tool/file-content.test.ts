import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { estimateAutonomousLineDelta, isBinaryFile } from "../../src/tool/file-content"

describe("file-content autonomous line delta", () => {
  test("extensionless binary with NUL bytes charges zero lines", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "sdluatex")
    await fs.writeFile(filePath, Buffer.concat([Buffer.from("ELF"), Buffer.alloc(997, 0)]))

    expect(await isBinaryFile(filePath)).toBe(true)
    expect(await estimateAutonomousLineDelta(filePath)).toBe(0)
  })

  test("known binary extension charges zero lines without sampling", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "archive.zip")
    await fs.writeFile(filePath, Buffer.from("PK\u0003\u0004plain-looking-payload"))

    expect(await isBinaryFile(filePath)).toBe(true)
    expect(await estimateAutonomousLineDelta(filePath)).toBe(0)
  })

  test("text payload uses ceil(size / 80), not newline count", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "blob.txt")
    const payload = "x".repeat(1000)
    await fs.writeFile(filePath, payload)

    expect(await isBinaryFile(filePath)).toBe(false)
    expect(await estimateAutonomousLineDelta(filePath)).toBe(Math.ceil(payload.length / 80))
    expect(await estimateAutonomousLineDelta(filePath)).not.toBe(1)
  })

  test("empty text file still charges the one-line minimum", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "empty.txt")
    await fs.writeFile(filePath, "")

    expect(await isBinaryFile(filePath)).toBe(false)
    expect(await estimateAutonomousLineDelta(filePath)).toBe(1)
  })

  test("classification failure never produces a binary zero-line exemption", async () => {
    await using tmp = await tmpdir()
    const missing = path.join(tmp.path, "missing-binary")
    expect(await isBinaryFile(missing)).toBe(false)
    expect(await estimateAutonomousLineDelta(missing)).toBe(1)

    if (process.platform === "win32") return

    const locked = path.join(tmp.path, "unreadable")
    await fs.writeFile(locked, Buffer.alloc(400, 0))
    await fs.chmod(locked, 0o000)
    try {
      expect(await isBinaryFile(locked)).toBe(false)
      expect(await estimateAutonomousLineDelta(locked)).toBe(Math.ceil(400 / 80))
    } finally {
      await fs.chmod(locked, 0o600)
    }
  })
})
