// Extract plain text from a PDF for the `read` tool when the active model
// cannot take PDF input (ADR-278). The runtime has no in-process PDF parser;
// extraction runs poppler's `pdftotext` when it is on PATH and returns a short
// reason otherwise. Output mirrors office-text: the body is capped at 200 KB
// and wrapped in the `<extracted_text kind="pdf">` envelope, treated as data.

import { Process } from "../util/process"
import { which } from "../util/which"

const MAX_OUTPUT_BYTES = 200 * 1024
const PDFTOTEXT_TIMEOUT_MS = 30_000

export const PDFTOTEXT_MISSING_REASON =
  "pdftotext (poppler) is not installed, so the PDF cannot be read as text for a model without PDF input"

export interface PdfExtraction {
  kind: "pdf"
  /** Extracted plain text, labeled and wrapped in an envelope. */
  text: string
  /** True when the body was capped to MAX_OUTPUT_BYTES. */
  truncated?: boolean
  /** Reason the file was not extracted (only when `text === ""`). */
  reason?: string
}

export interface PdfExtractOptions {
  abort?: AbortSignal
  /** Where `pdftotext` is, or null when it is not installed; defaults to a PATH lookup. */
  resolveBinary?: () => string | null
}

function labelEnvelope(body: string, truncated: boolean): string {
  if (truncated) {
    return `<extracted_text kind="pdf">\n[truncated to 200 KB]\n${body}\n</extracted_text>`
  }
  return `<extracted_text kind="pdf">\n${body}\n</extracted_text>`
}

export async function extractPdfText(filePath: string, options: PdfExtractOptions = {}): Promise<PdfExtraction> {
  const binary = (options.resolveBinary ?? (() => which("pdftotext")))()
  if (!binary) return { kind: "pdf", text: "", reason: PDFTOTEXT_MISSING_REASON }

  // `-layout` keeps columns and tables readable; "-" writes to stdout.
  const result = await Process.run([binary, "-layout", "-enc", "UTF-8", filePath, "-"], {
    nothrow: true,
    timeout: PDFTOTEXT_TIMEOUT_MS,
    abort: options.abort,
  })
  // `nothrow` reports an aborted child as exit code 1, so surface the abort
  // before it is mistaken for an extraction failure.
  options.abort?.throwIfAborted()
  if (result.code === 124) {
    return { kind: "pdf", text: "", reason: `pdftotext timed out after ${PDFTOTEXT_TIMEOUT_MS / 1000} s` }
  }
  if (result.code !== 0) {
    const detail = result.stderr.toString("utf8").trim().split("\n")[0] ?? ""
    return {
      kind: "pdf",
      text: "",
      reason: detail ? `pdftotext could not read the PDF: ${detail}` : `pdftotext exited with code ${result.code}`,
    }
  }

  // Pages are separated by form feeds; keep them as blank lines.
  const raw = result.stdout.toString("utf8").replace(/\f/g, "\n").trim()
  if (!raw) {
    return { kind: "pdf", text: "", reason: "pdftotext found no text in the PDF (a scanned document needs OCR)" }
  }
  const bytes = Buffer.from(raw, "utf8")
  const truncated = bytes.length > MAX_OUTPUT_BYTES
  let body = raw
  if (truncated) {
    // A slice at exactly the cap can split a multibyte sequence and emit
    // U+FFFD; back up to the start of the next UTF-8 code point instead.
    let end = MAX_OUTPUT_BYTES
    while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--
    body = bytes.subarray(0, end).toString("utf8")
  }
  return { kind: "pdf", text: labelEnvelope(body, truncated), truncated }
}
