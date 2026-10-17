import { describe, expect, test } from "vitest"
import zlib from "node:zlib"
import { writeFile } from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { detectOfficeKind, extractOfficeText } from "../../src/tool/office-text"

/* -------------------------------------------------------------------------- */
/*                            In-test zip writer                               */
/* -------------------------------------------------------------------------- */

interface ZipEntry {
  name: string
  data: Buffer
  /** ms-dos time/date stamp for entries; defaults to a fixed recent value. */
  mtime?: Date
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
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function dosTime(d: Date): { time: number; date: number } {
  // (year-1980)<<9 | month<<5 | day
  const date = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate()
  // hours<<11 | minutes<<5 | (seconds/2)
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2)
  return { time, date }
}

function buildZip(entries: ZipEntry[]): Buffer {
  const now = new Date()
  const { time, date } = dosTime(now)

  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let localOffset = 0

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8")
    const compressed = zlib.deflateRawSync(e.data, { level: 6 })
    const crc = crc32(e.data)
    const size = e.data.length
    const csize = compressed.length
    const mt = e.mtime ?? now
    const mtimeT = ((mt.getUTCHours() << 11) | (mt.getUTCMinutes() << 5) | Math.floor(mt.getUTCSeconds() / 2)) & 0xffff
    const mtimeD = (((mt.getUTCFullYear() - 1980) << 9) | ((mt.getUTCMonth() + 1) << 5) | mt.getUTCDate()) & 0xffff

    // Local file header (30 bytes + name + extra)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // signature
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(8, 8) // method: deflate
    local.writeUInt16LE(mtimeT, 10)
    local.writeUInt16LE(mtimeD, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(csize, 18)
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra length
    localParts.push(local, nameBuf, compressed)

    // Central directory entry (46 bytes + name + extra + comment)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0) // signature
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0, 8) // flags
    central.writeUInt16LE(8, 10) // method
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(csize, 20)
    central.writeUInt32LE(size, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(localOffset, 42)
    centralParts.push(central, nameBuf)

    localOffset += local.length + nameBuf.length + compressed.length
  }

  const centralStart = localOffset
  let centralSize = 0
  for (const part of centralParts) centralSize += part.length
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0) // signature
  eocd.writeUInt16LE(0, 4) // disk
  eocd.writeUInt16LE(0, 6) // start disk
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(centralStart, 16)
  eocd.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([...localParts, ...centralParts, eocd])
}

/* -------------------------------------------------------------------------- */
/*                              Tests                                          */
/* -------------------------------------------------------------------------- */

describe("detectOfficeKind", () => {
  test("recognizes the three Open XML extensions", () => {
    expect(detectOfficeKind("/a/foo.docx")).toBe("docx")
    expect(detectOfficeKind("/a/foo.xlsx")).toBe("xlsx")
    expect(detectOfficeKind("/a/foo.pptx")).toBe("pptx")
    expect(detectOfficeKind("/a/foo.DOCX")).toBe("docx")
  })
  test("returns undefined for other extensions", () => {
    expect(detectOfficeKind("/a/foo.zip")).toBeUndefined()
    expect(detectOfficeKind("/a/foo.txt")).toBeUndefined()
    expect(detectOfficeKind("/a/foo")).toBeUndefined()
  })
})

describe("extractOfficeText - docx", () => {
  test("extracts paragraphs with text runs and tab breaks", async () => {
    await using tmp = await tmpdir()
    const xml = `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>First paragraph</w:t></w:r></w:p>
    <w:p>
      <w:r><w:t>cell one</w:t></w:r>
      <w:r><w:tab/></w:r>
      <w:r><w:t>cell two</w:t></w:r>
    </w:p>
    <w:p><w:r><w:t>Third &amp; final</w:t></w:r></w:p>
  </w:body>
</w:document>`
    const filePath = path.join(tmp.path, "sample.docx")
    const buf = buildZip([
      { name: "[Content_Types].xml", data: Buffer.from("<?xml version='1.0'?><dummy/>") },
      { name: "_rels/.rels", data: Buffer.from("<?xml version='1.0'?><dummy/>") },
      { name: "word/document.xml", data: Buffer.from(xml) },
    ])
    await writeFile(filePath, buf)

    const result = await extractOfficeText(filePath)
    expect(result.reason).toBeUndefined()
    expect(result.text).toMatch(/<extracted_text kind="docx">/)
    expect(result.text).toContain("First paragraph")
    expect(result.text).toContain("cell one")
    expect(result.text).toContain("cell two")
    expect(result.text).toContain("Third & final")
    // Tab joins the runs on a single line: `cell one<TAB>cell two`.
    expect(result.text).toMatch(/cell one\tcell two/)
  })

  test("returns a short reason when document.xml is missing", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "empty.docx")
    const buf = buildZip([{ name: "[Content_Types].xml", data: Buffer.from("dummy") }])
    await writeFile(filePath, buf)
    const result = await extractOfficeText(filePath)
    expect(result.text).toBe("")
    expect(result.reason).toMatch(/no content extracted|missing/i)
  })
})

describe("extractOfficeText - xlsx", () => {
  test("extracts shared-string cells with the sheet name as a heading", async () => {
    await using tmp = await tmpdir()
    const shared = `<?xml version="1.0"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3">
  <si><t>Alpha</t></si>
  <si><t>Beta</t></si>
  <si><t>Gamma</t></si>
</sst>`
    const sheet = `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>2</v></c>
      <c r="B2"><v>42</v></c>
    </row>
  </sheetData>
</worksheet>`
    const workbook = `<?xml version="1.0"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sales" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
    const filePath = path.join(tmp.path, "sample.xlsx")
    const buf = buildZip([
      { name: "[Content_Types].xml", data: Buffer.from("dummy") },
      { name: "xl/sharedStrings.xml", data: Buffer.from(shared) },
      { name: "xl/workbook.xml", data: Buffer.from(workbook) },
      { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet) },
    ])
    await writeFile(filePath, buf)

    const result = await extractOfficeText(filePath)
    expect(result.reason).toBeUndefined()
    expect(result.text).toMatch(/<extracted_text kind="xlsx">/)
    expect(result.text).toContain("# Sales")
    expect(result.text).toContain("Alpha\tBeta")
    expect(result.text).toContain("Gamma\t42")
  })

  test("supports inline strings", async () => {
    await using tmp = await tmpdir()
    const sheet = `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>hello</t></is></c>
    </row>
  </sheetData>
</worksheet>`
    const filePath = path.join(tmp.path, "inline.xlsx")
    const buf = buildZip([
      {
        name: "xl/workbook.xml",
        data: Buffer.from(
          `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Inline" sheetId="1" r:id="rId1"/></sheets></workbook>`,
        ),
      },
      { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet) },
    ])
    await writeFile(filePath, buf)

    const result = await extractOfficeText(filePath)
    expect(result.reason).toBeUndefined()
    expect(result.text).toContain("# Inline")
    expect(result.text).toContain("hello")
  })
})

describe("extractOfficeText - xlsx multiple sheets", () => {
  test("extracts every worksheet in order with its own heading", async () => {
    await using tmp = await tmpdir()
    const cell = (text: string) =>
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${text}</t></is></c></row></sheetData></worksheet>`
    const workbook = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="First" sheetId="1" r:id="rId1"/><sheet name="Second &amp; more" sheetId="2" r:id="rId2"/></sheets></workbook>`
    const filePath = path.join(tmp.path, "two.xlsx")
    await writeFile(
      filePath,
      buildZip([
        { name: "xl/workbook.xml", data: Buffer.from(workbook) },
        { name: "xl/worksheets/sheet2.xml", data: Buffer.from(cell("second-body")) },
        { name: "xl/worksheets/sheet1.xml", data: Buffer.from(cell("first-body")) },
      ]),
    )
    const result = await extractOfficeText(filePath)
    const text = result.text ?? ""
    expect(text).toContain("# First")
    expect(text).toContain("# Second & more")
    expect(text.indexOf("first-body")).toBeLessThan(text.indexOf("second-body"))
  })
})

describe("extractOfficeText - pptx", () => {
  test("extracts slide text in numeric order and adds per-slide headings", async () => {
    await using tmp = await tmpdir()
    const slide1 = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody>
      <a:p><a:r><a:t>Title slide</a:t></a:r></a:p>
    </p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`
    const slide2 = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody>
      <a:p><a:r><a:t>Body bullet one</a:t></a:r></a:p>
      <a:p><a:r><a:t>Body bullet two</a:t></a:r></a:p>
    </p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`
    const filePath = path.join(tmp.path, "deck.pptx")
    const buf = buildZip([
      { name: "ppt/slides/slide2.xml", data: Buffer.from(slide2) },
      { name: "ppt/slides/slide1.xml", data: Buffer.from(slide1) },
    ])
    await writeFile(filePath, buf)

    const result = await extractOfficeText(filePath)
    expect(result.reason).toBeUndefined()
    expect(result.text).toMatch(/<extracted_text kind="pptx">/)
    const slide1Idx = result.text.indexOf("# Slide 1")
    const slide2Idx = result.text.indexOf("# Slide 2")
    expect(slide1Idx).toBeGreaterThanOrEqual(0)
    expect(slide2Idx).toBeGreaterThan(slide1Idx)
    expect(result.text).toContain("Title slide")
    expect(result.text).toContain("Body bullet one")
    expect(result.text).toContain("Body bullet two")
  })

  test("renders notes when present", async () => {
    await using tmp = await tmpdir()
    const slide = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>on-screen</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`
    const notes = `<?xml version="1.0"?>
<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>speaker note</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:notes>`
    const filePath = path.join(tmp.path, "with-notes.pptx")
    const buf = buildZip([
      { name: "ppt/slides/slide1.xml", data: Buffer.from(slide) },
      { name: "ppt/notesSlides/notesSlide1.xml", data: Buffer.from(notes) },
    ])
    await writeFile(filePath, buf)

    const result = await extractOfficeText(filePath)
    expect(result.text).toContain("on-screen")
    expect(result.text).toContain("# Notes 1")
    expect(result.text).toContain("speaker note")
  })
})

describe("extractOfficeText - safety", () => {
  test("rejects a non-zip file with a short reason", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "junk.docx")
    await writeFile(filePath, "not a zip at all")
    const result = await extractOfficeText(filePath)
    expect(result.text).toBe("")
    expect(result.reason).toMatch(/not a valid Office file|zip/)
  })

  test("rejects an archive whose central directory is missing", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "truncated.docx")
    // Local file header only, no EOCD.
    const truncated = Buffer.from([
      0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ])
    await writeFile(filePath, truncated)
    const result = await extractOfficeText(filePath)
    expect(result.text).toBe("")
    expect(result.reason).toBeDefined()
  })

  test("rejects archives exceeding the total uncompressed size cap", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "bomb.docx")
    // One big entry that claims 50 MB+1 of uncompressed data. We don't actually
    // inflate it because the size guard runs before any decompression.
    const huge = Buffer.alloc(50 * 1024 * 1024 + 1, 0x61) // 50 MB + 1
    const buf = buildZip([{ name: "word/document.xml", data: huge }])
    await writeFile(filePath, buf)
    const result = await extractOfficeText(filePath)
    expect(result.text).toBe("")
    expect(result.reason).toMatch(/too large|exceeds/i)
  })

  test("caps extraction output to 200 KB", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "huge.docx")
    // 200 KB of text spread across many paragraphs. We pad to a bit over
    // 200 KB so the cap actually fires.
    const para = "x".repeat(200)
    const xml = `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${Array.from({ length: 1500 }, () => `<w:p><w:r><w:t>${para}</w:t></w:r></w:p>`).join("")}</w:body>
</w:document>`
    const buf = buildZip([{ name: "word/document.xml", data: Buffer.from(xml) }])
    await writeFile(filePath, buf)
    const result = await extractOfficeText(filePath)
    expect(result.truncated).toBe(true)
    // The label envelope itself is small; strip both the truncation note and
    // the envelope so the inner body is what we measured against the cap.
    const body = result.text
      .replace(/^<extracted_text[^>]*>\n(?:\[truncated to 200 KB\]\n)?/, "")
      .replace(/\n<\/extracted_text>$/, "")
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(200 * 1024)
  })

  test("caps extraction output to 200 KB for multibyte text", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "huge-cjk.docx")
    // 70k CJK characters: 70_000 UTF-16 code units (below the cap) but
    // 210_000 UTF-8 bytes (above it). A code-unit slice would keep everything
    // while still reporting truncated.
    const para = "字".repeat(175)
    const xml = `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${Array.from({ length: 400 }, () => `<w:p><w:r><w:t>${para}</w:t></w:r></w:p>`).join("")}</w:body>
</w:document>`
    const buf = buildZip([{ name: "word/document.xml", data: Buffer.from(xml) }])
    await writeFile(filePath, buf)
    const result = await extractOfficeText(filePath)
    expect(result.truncated).toBe(true)
    const body = result.text
      .replace(/^<extracted_text[^>]*>\n(?:\[truncated to 200 KB\]\n)?/, "")
      .replace(/\n<\/extracted_text>$/, "")
    // A mid-character byte cut decodes as one U+FFFD (3 bytes), so allow the
    // cap plus that single replacement character.
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(200 * 1024 + 3)
    // The content really was shortened: 70k source characters cannot fit whole.
    expect(body.length).toBeLessThan(70_000)
  })

  test("encrypted entries are rejected with a short reason", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "encrypted.docx")
    // Mark the local header with the encryption flag (bit 0) and append
    // junk data after the name. The size and CRC will be wrong but the
    // zip reader should never get past the encrypted-entry guard.
    const name = Buffer.from("word/document.xml")
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x01, 6) // flags: encrypted
    local.writeUInt16LE(8, 8) // method
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(0, 14)
    local.writeUInt32LE(0, 18)
    local.writeUInt32LE(0, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x01, 8) // flags: encrypted
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(0, 16)
    central.writeUInt32LE(0, 20)
    central.writeUInt32LE(0, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(30 + name.length, 42)
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(0, 4)
    eocd.writeUInt16LE(0, 6)
    eocd.writeUInt16LE(1, 8)
    eocd.writeUInt16LE(1, 10)
    eocd.writeUInt32LE(46 + name.length, 12)
    eocd.writeUInt32LE(30 + name.length, 16)
    eocd.writeUInt16LE(0, 20)
    const buf = Buffer.concat([local, name, Buffer.alloc(0), central, name, eocd])
    await writeFile(filePath, buf)
    const result = await extractOfficeText(filePath)
    expect(result.text).toBe("")
    expect(result.reason).toMatch(/encrypted|not supported/i)
  })
})
