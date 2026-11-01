// A minimal PDF 1.4 with one Helvetica text line per row, 60 rows per page,
// and a correct cross-reference table: enough for pdftotext to extract every
// line, however many pages the lines need.
const LINES_PER_PAGE = 60

export function buildPdf(lines: string[]): Buffer {
  const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
  const pages: string[][] = []
  for (let index = 0; index < Math.max(lines.length, 1); index += LINES_PER_PAGE) {
    pages.push(lines.slice(index, index + LINES_PER_PAGE))
  }
  // Object numbers: 1 catalog, 2 pages, 3 font, then (page, contents) pairs.
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  const pageRefs: string[] = []
  for (const pageLines of pages) {
    const ops = ["BT", "/F1 10 Tf", "36 760 Td", "12 TL"]
    for (const line of pageLines) ops.push(`(${escape(line)}) Tj`, "T*")
    ops.push("ET")
    const content = ops.join("\n")
    const pageNumber = objects.length + 1
    const contentsNumber = pageNumber + 1
    pageRefs.push(`${pageNumber} 0 R`)
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentsNumber} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
      `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    )
  }
  objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pageRefs.length} >>`
  let out = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out, "latin1"))
    out += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out, "latin1")
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, "latin1")
}
