import { describe, expect, test } from "vitest"
import { writeFile } from "fs/promises"
import path from "path"
import { PDFTOTEXT_MISSING_REASON, extractPdfText } from "../../src/tool/pdf-text"
import { which } from "../../src/util/which"
import { tmpdir } from "../fixture/fixture"
import { buildPdf } from "./pdf-fixture"

const hasPdftotext = which("pdftotext") !== null

describe("pdf-text (ADR-278)", () => {
  test("reports a reason when pdftotext is not installed", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "doc.pdf")
    await writeFile(filePath, buildPdf(["hello"]))
    const result = await extractPdfText(filePath, { resolveBinary: () => null })
    expect(result).toEqual({ kind: "pdf", text: "", reason: PDFTOTEXT_MISSING_REASON })
  })

  test("reports a reason when the extractor cannot be started", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "doc.pdf")
    await writeFile(filePath, buildPdf(["hello"]))
    const result = await extractPdfText(filePath, {
      resolveBinary: () => path.join(tmp.path, "missing-pdftotext"),
    })
    expect(result.text).toBe("")
    expect(result.reason).toMatch(/pdftotext/)
  })

  test.skipIf(!hasPdftotext)("returns the page text in the envelope", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "doc.pdf")
    await writeFile(filePath, buildPdf(["First line of the report", "Second line"]))
    const result = await extractPdfText(filePath)
    expect(result.reason).toBeUndefined()
    expect(result.truncated).toBe(false)
    expect(result.text).toMatch(/^<extracted_text kind="pdf">\n/)
    expect(result.text).toContain("First line of the report")
    expect(result.text).toContain("Second line")
    expect(result.text).not.toContain("\f")
  })

  test.skipIf(!hasPdftotext)("caps the body at 200 KB", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "big.pdf")
    const line = "x".repeat(80)
    await writeFile(filePath, buildPdf(Array.from({ length: 4000 }, () => line)))
    const result = await extractPdfText(filePath)
    expect(result.reason).toBeUndefined()
    expect(result.truncated).toBe(true)
    expect(result.text).toContain("[truncated to 200 KB]")
    const body = result.text
      .replace(/^<extracted_text kind="pdf">\n\[truncated to 200 KB\]\n/, "")
      .replace(/\n<\/extracted_text>$/, "")
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(200 * 1024)
  })

  test.skipIf(!hasPdftotext)("reports a reason for a file that is not a PDF", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "broken.pdf")
    await writeFile(filePath, "not a pdf at all")
    const result = await extractPdfText(filePath)
    expect(result.text).toBe("")
    expect(result.reason).toMatch(/pdftotext/)
  })
})
