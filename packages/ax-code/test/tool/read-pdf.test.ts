// Focused integration test for the read.ts PDF text fallback (ADR-278): a
// model whose capabilities say it cannot take PDF input gets extracted text
// instead of an attachment; any other model keeps the attachment.
import { afterEach, describe, expect, test } from "vitest"
import { writeFile } from "fs/promises"
import path from "path"
import { ReadTool } from "../../src/tool/read"
import { Instance } from "../../src/project/instance"
import { SessionID, MessageID } from "../../src/session/schema"
import { which } from "../../src/util/which"
import { tmpdir } from "../fixture/fixture"
import { buildPdf } from "./pdf-fixture"

const hasPdftotext = which("pdftotext") !== null

afterEach(async () => {
  await Instance.disposeAll()
})

const baseCtx = {
  sessionID: SessionID.make("ses_read_pdf"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

const withModel = (pdf: boolean | undefined) => ({
  ...baseCtx,
  extra: pdf === undefined ? {} : { model: { capabilities: { input: { text: true, image: false, pdf } } } },
})

describe("read.ts ADR-278 PDF fallback", () => {
  test.skipIf(!hasPdftotext)("a model without PDF input gets the extracted text", async () => {
    await using tmp = await tmpdir({ git: true, config: { username: "tester" } })
    const filePath = path.join(tmp.path, "report.pdf")
    await writeFile(filePath, buildPdf(["Quarterly numbers", "Revenue up"]))
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath }, withModel(false))
        expect(result.title).toContain("report.pdf")
        expect(result.output).toMatch(/<extracted_text kind="pdf">/)
        expect(result.output).toContain("Quarterly numbers")
        expect(result.output).toContain("Revenue up")
        expect((result.data as { kind?: string })?.kind).toBe("text")
        expect(result.attachments ?? []).toHaveLength(0)
      },
    })
  })

  test("a model with PDF input keeps the attachment", async () => {
    await using tmp = await tmpdir({ git: true, config: { username: "tester" } })
    const filePath = path.join(tmp.path, "report.pdf")
    await writeFile(filePath, buildPdf(["Quarterly numbers"]))
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath }, withModel(true))
        expect((result.data as { kind?: string })?.kind).toBe("media")
        expect(result.attachments).toHaveLength(1)
        expect(result.attachments?.[0]?.mime).toBe("application/pdf")
      },
    })
  })

  test("without a model the attachment is kept", async () => {
    await using tmp = await tmpdir({ git: true, config: { username: "tester" } })
    const filePath = path.join(tmp.path, "report.pdf")
    await writeFile(filePath, buildPdf(["Quarterly numbers"]))
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath }, withModel(undefined))
        expect((result.data as { kind?: string })?.kind).toBe("media")
        expect(result.attachments).toHaveLength(1)
      },
    })
  })

  test.skipIf(!hasPdftotext)("a corrupted PDF throws a short ReadPdfExtractionError", async () => {
    await using tmp = await tmpdir({ git: true, config: { username: "tester" } })
    const filePath = path.join(tmp.path, "broken.pdf")
    await writeFile(filePath, "not a pdf at all")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        await expect(read.execute({ filePath }, withModel(false))).rejects.toMatchObject({
          name: "ReadPdfExtractionError",
        })
      },
    })
  })
})
