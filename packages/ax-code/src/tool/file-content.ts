import fs from "fs/promises"
import path from "path"
import { Filesystem } from "@/util/filesystem"

const BINARY_SAMPLE_BYTES = 4096
const BINARY_NON_PRINTABLE_RATIO = 0.3

/**
 * Detect whether `filePath` is a binary file.
 *
 * Known binary extensions short-circuit. Otherwise a bounded prefix is sampled
 * for a NUL byte or a high ratio of non-printable bytes — the same rule the
 * `read` tool uses, including for extensionless executables such as `sdluatex`.
 *
 * Classification failure (unreadable / unstat-able path) returns `false` so
 * callers cannot treat an unknown file as a binary exemption.
 */
export async function isBinaryFile(filePath: string): Promise<boolean> {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case ".zip":
    case ".tar":
    case ".gz":
    case ".exe":
    case ".dll":
    case ".so":
    case ".class":
    case ".jar":
    case ".war":
    case ".7z":
    case ".doc":
    case ".docx":
    case ".xls":
    case ".xlsx":
    case ".ppt":
    case ".pptx":
    case ".odt":
    case ".ods":
    case ".odp":
    case ".bin":
    case ".dat":
    case ".obj":
    case ".o":
    case ".a":
    case ".lib":
    case ".wasm":
    case ".pyc":
    case ".pyo":
      return true
    default:
      break
  }

  const fh = await fs.open(filePath, "r").catch(() => undefined)
  if (!fh) return false
  try {
    const stat = await fh.stat()
    if (!stat.isFile() || stat.size === 0) return false
    const sampleSize = Math.min(BINARY_SAMPLE_BYTES, stat.size)
    const bytes = Buffer.alloc(sampleSize)
    const result = await fh.read(bytes, 0, sampleSize, 0)
    if (result.bytesRead === 0) return false

    let nonPrintableCount = 0
    for (let i = 0; i < result.bytesRead; i++) {
      if (bytes[i] === 0) return true
      if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
        nonPrintableCount++
      }
    }
    return nonPrintableCount / result.bytesRead > BINARY_NON_PRINTABLE_RATIO
  } finally {
    await fh.close()
  }
}

/**
 * Line-delta charged against the autonomous blast-radius line cap for a
 * shell write (`cp`, `curl -o`, `>`, …).
 *
 * Confidently detected binaries contribute **zero lines** (they still count
 * as one file). Text keeps the historical `ceil(size / 80)` heuristic so a
 * dense / minified payload cannot evade the cap by having few newlines.
 * Missing or non-file paths charge 1, matching the previous estimator.
 */
export async function estimateAutonomousLineDelta(filePath: string): Promise<number> {
  const stat = await fs.stat(filePath).catch((error: NodeJS.ErrnoException) => {
    if (Filesystem.isMissingPathError(error)) return undefined
    throw error
  })
  if (!stat?.isFile()) return 1

  let binary = false
  try {
    binary = await isBinaryFile(filePath)
  } catch {
    binary = false
  }
  if (binary) return 0
  return Math.max(1, Math.ceil(stat.size / 80))
}
