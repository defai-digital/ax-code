// Focused integration test for the read.ts Office extraction branch added by
// ADR-238. Uses `config: { username: "tester" }` on the tmpdir so config
// load doesn't trip the sandbox's missing-username system error (the
// broader read.test.ts suite fails on that env issue independently of any
// code under test).
import { afterEach, describe, expect, test } from "vitest"
import { writeFile } from "fs/promises"
import zlib from "node:zlib"
import path from "path"
import { ReadTool } from "../../src/tool/read"
import { Instance } from "../../src/project/instance"
import { SessionID, MessageID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

interface ZipEntry {
  name: string
  data: Buffer
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function buildZip(entries: ZipEntry[]): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let localOffset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8")
    const compressed = zlib.deflateRawSync(e.data, { level: 6 })
    const crc = crc32(e.data)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0, 6)
    localHeader.writeUInt16LE(8, 8)
    localHeader.writeUInt16LE(0, 10)
    localHeader.writeUInt16LE(0, 12)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(compressed.length, 18)
    localHeader.writeUInt32LE(e.data.length, 22)
    localHeader.writeUInt16LE(name.length, 26)
    localHeader.writeUInt16LE(0, 28)
    local.push(localHeader, name, compressed)
    const centralEntry = Buffer.alloc(46)
    centralEntry.writeUInt32LE(0x02014b50, 0)
    centralEntry.writeUInt16LE(20, 4)
    centralEntry.writeUInt16LE(20, 6)
    centralEntry.writeUInt16LE(0, 8)
    centralEntry.writeUInt16LE(8, 10)
    centralEntry.writeUInt16LE(0, 12)
    centralEntry.writeUInt16LE(0, 14)
    centralEntry.writeUInt32LE(crc, 16)
    centralEntry.writeUInt32LE(compressed.length, 20)
    centralEntry.writeUInt32LE(e.data.length, 24)
    centralEntry.writeUInt16LE(name.length, 28)
    centralEntry.writeUInt16LE(0, 30)
    centralEntry.writeUInt16LE(0, 32)
    centralEntry.writeUInt16LE(0, 34)
    centralEntry.writeUInt16LE(0, 36)
    centralEntry.writeUInt32LE(0, 38)
    centralEntry.writeUInt32LE(localOffset, 42)
    central.push(centralEntry, name)
    localOffset += localHeader.length + name.length + compressed.length
  }
  const centralStart = localOffset
  let centralSize = 0
  for (const p of central) centralSize += p.length
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(centralStart, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...local, ...central, eocd])
}

afterEach(async () => {
  await Instance.disposeAll()
})

const ctx = {
  sessionID: SessionID.make("ses_read_office"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("read.ts ADR-238 Office branch", () => {
  test("read on a .docx returns extracted plain text inside an envelope", async () => {
    await using tmp = await tmpdir({ git: true, config: { username: "tester" } })
    const docx = `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>First paragraph</w:t></w:r></w:p>
    <w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p>
  </w:body>
</w:document>`
    const buf = buildZip([{ name: "word/document.xml", data: Buffer.from(docx) }])
    const filePath = path.join(tmp.path, "sample.docx")
    await writeFile(filePath, buf)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath }, ctx)
        expect(result.title).toContain("sample.docx")
        expect(result.output).toMatch(/<extracted_text kind="docx">/)
        expect(result.output).toContain("First paragraph")
        expect(result.output).toContain("Second paragraph")
        // Standard text envelope, not media.
        expect((result.data as { kind?: string })?.kind ?? "text").toBe("text")
        // metadata.truncated is a boolean, not "truncated" string.
        expect(typeof result.metadata?.truncated).toBe("boolean")
      },
    })
  })

  test("read on a corrupted .docx throws a short ReadOfficeExtractionError", async () => {
    await using tmp = await tmpdir({ git: true, config: { username: "tester" } })
    const filePath = path.join(tmp.path, "broken.docx")
    await writeFile(filePath, "not a zip at all")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        await expect(read.execute({ filePath }, ctx)).rejects.toMatchObject({
          name: "ReadOfficeExtractionError",
        })
      },
    })
  })

  test("read on a .xlsx returns extracted shared-string cells", async () => {
    await using tmp = await tmpdir({ git: true, config: { username: "tester" } })
    const shared = `<?xml version="1.0"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2">
  <si><t>Alpha</t></si>
  <si><t>Beta</t></si>
</sst>`
    const sheet = `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
    </row>
  </sheetData>
</worksheet>`
    const workbook = `<?xml version="1.0"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
    const buf = buildZip([
      { name: "xl/sharedStrings.xml", data: Buffer.from(shared) },
      { name: "xl/workbook.xml", data: Buffer.from(workbook) },
      { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet) },
    ])
    const filePath = path.join(tmp.path, "sample.xlsx")
    await writeFile(filePath, buf)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath }, ctx)
        expect(result.output).toMatch(/<extracted_text kind="xlsx">/)
        expect(result.output).toContain("# Sheet1")
        expect(result.output).toContain("Alpha\tBeta")
      },
    })
  })
})
