import type { LanguageModelV3Prompt } from "@ai-sdk/provider"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

// CLI providers (claude-code, gemini-cli, codex-cli, grok-build-cli) take images
// and other files as paths their own file/image tools read — not as inline text.
// We materialize each file part to a temp file (or keep a remote URL as-is) and
// hand the references to promptToText, which lists them so the spawned agent can
// open them. The temp dir is removed once the CLI process exits.

export interface CliAttachmentRef {
  // A local temp-file path the spawned CLI can read, or a remote URL it can fetch.
  path?: string
  url?: string
  mediaType: string
}

export interface MaterializedCliAttachments {
  refs: CliAttachmentRef[]
  cleanup: () => Promise<void>
}

const NOOP_CLEANUP = async () => {}

function extensionFor(mediaType: string, filename?: string): string {
  if (filename) {
    const ext = path.extname(filename)
    if (ext) return ext
  }
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/bmp": ".bmp",
    "image/svg+xml": ".svg",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "text/markdown": ".md",
  }
  return map[mediaType.toLowerCase()] ?? ".bin"
}

function decodeBase64Bytes(value: string): Uint8Array | undefined {
  const normalized = value.replace(/\s+/g, "")
  if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return undefined
  return new Uint8Array(Buffer.from(normalized, "base64"))
}

function decodeDataUrl(value: string): { bytes?: Uint8Array } {
  const comma = value.indexOf(",")
  if (comma === -1) return {}
  const meta = value.slice("data:".length, comma)
  const payload = value.slice(comma + 1)
  try {
    if (/;base64/i.test(meta)) return { bytes: decodeBase64Bytes(payload) }
    return { bytes: new Uint8Array(Buffer.from(decodeURIComponent(payload), "utf8")) }
  } catch {
    return {}
  }
}

function isDataUrl(value: string) {
  return /^data:/i.test(value)
}

function decodeFileData(data: unknown): { bytes?: Uint8Array; url?: string } {
  if (data instanceof Uint8Array) return { bytes: data }
  if (data instanceof ArrayBuffer) return { bytes: new Uint8Array(data) }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) return { bytes: new Uint8Array(data) }
  if (data instanceof URL) {
    const value = data.toString()
    return isDataUrl(value) ? decodeDataUrl(value) : { url: value }
  }
  if (typeof data === "string") {
    if (isDataUrl(data)) return decodeDataUrl(data)
    if (/^https?:\/\//i.test(data)) return { url: data }
    // Bare string is assumed to be base64-encoded bytes.
    return { bytes: decodeBase64Bytes(data) }
  }
  return {}
}

export async function materializeCliAttachments(prompt: LanguageModelV3Prompt): Promise<MaterializedCliAttachments> {
  const parts: { data: unknown; mediaType: string; filename?: string }[] = []
  for (const message of prompt) {
    if (message.role !== "user") continue
    for (const part of message.content) {
      if (part.type !== "file") continue
      const filePart = part as { data: unknown; mediaType?: string; filename?: string }
      parts.push({
        data: filePart.data,
        mediaType: filePart.mediaType ?? "application/octet-stream",
        filename: filePart.filename,
      })
    }
  }
  if (parts.length === 0) return { refs: [], cleanup: NOOP_CLEANUP }

  let dir: string | undefined
  const refs: CliAttachmentRef[] = []
  try {
    for (const part of parts) {
      const decoded = decodeFileData(part.data)
      if (decoded.url) {
        refs.push({ url: decoded.url, mediaType: part.mediaType })
        continue
      }
      if (!decoded.bytes) continue
      if (!dir) dir = await mkdtemp(path.join(tmpdir(), "ax-code-cli-attach-"))
      const file = path.join(dir, `attachment-${refs.length}${extensionFor(part.mediaType, part.filename)}`)
      await writeFile(file, decoded.bytes)
      refs.push({ path: file, mediaType: part.mediaType })
    }
  } catch (error) {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
    throw error
  }

  if (!dir) return { refs, cleanup: NOOP_CLEANUP }
  const dirToClean = dir
  return {
    refs,
    cleanup: async () => {
      await rm(dirToClean, { recursive: true, force: true }).catch(() => {})
    },
  }
}
