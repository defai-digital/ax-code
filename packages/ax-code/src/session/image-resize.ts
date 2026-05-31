import { Log } from "@/util/log"

const log = Log.create({ service: "session.image-resize" })

const DEFAULT_MAX_WIDTH = 2000
const DEFAULT_MAX_HEIGHT = 2000
const DEFAULT_MAX_BASE64_BYTES = 5 * 1024 * 1024
const JPEG_QUALITIES = [80, 85, 70, 55, 40]

export type ImageResizeConfig = {
  auto_resize?: boolean
  max_width?: number
  max_height?: number
  max_base64_bytes?: number
}

export type ResizeResult =
  | { resized: false }
  | { resized: true; data: string; mime: string; bytes: number }
  | { resized: false; error: "too_large" }

let photon: typeof import("@silvia-odwyer/photon-node") | undefined

async function loadPhoton() {
  if (photon) return photon
  try {
    photon = await import("@silvia-odwyer/photon-node")
    return photon
  } catch {
    return undefined
  }
}

export async function maybeResizeImage(input: {
  buffer: Buffer
  mime: string
  config?: ImageResizeConfig
}): Promise<ResizeResult> {
  const { buffer, mime, config } = input
  if (!mime.startsWith("image/")) return { resized: false }

  const maxWidth = config?.max_width ?? DEFAULT_MAX_WIDTH
  const maxHeight = config?.max_height ?? DEFAULT_MAX_HEIGHT
  const maxBase64Bytes = config?.max_base64_bytes ?? DEFAULT_MAX_BASE64_BYTES
  const autoResize = config?.auto_resize ?? true

  const base64 = buffer.toString("base64")
  const base64Bytes = Buffer.byteLength(base64, "utf8")

  if (base64Bytes <= maxBase64Bytes) return { resized: false }

  if (!autoResize) {
    log.warn("image exceeds size limit; auto_resize is disabled", {
      command: "image-resize",
      status: "skipped",
      bytes: base64Bytes,
      maxBase64Bytes,
    })
    return { resized: false, error: "too_large" }
  }

  const lib = await loadPhoton()
  if (!lib) {
    log.warn("photon-node not available; skipping image resize", {
      command: "image-resize",
      status: "skipped",
    })
    return { resized: false }
  }

  try {
    const img = lib.PhotonImage.new_from_byteslice(new Uint8Array(buffer))
    const w = img.get_width()
    const h = img.get_height()

    let scale = Math.min(1, maxWidth / w, maxHeight / h)
    const MAX_CANDIDATES = 32

    try {
      for (let i = 0; i < MAX_CANDIDATES; i++) {
        const newW = Math.max(1, Math.round(w * scale))
        const newH = Math.max(1, Math.round(h * scale))
        const resized = lib.resize(img, newW, newH, lib.SamplingFilter.Lanczos3)

        let match: { data: string; mime: string; bytes: number } | undefined
        try {
          const candidates: { data: string; mime: string; bytes: number }[] = [
            { data: Buffer.from(resized.get_bytes()).toString("base64"), mime: "image/png" },
            ...JPEG_QUALITIES.map((quality) => ({
              data: Buffer.from(resized.get_bytes_jpeg(quality)).toString("base64"),
              mime: "image/jpeg",
            })),
          ].map((item) => ({ ...item, bytes: Buffer.byteLength(item.data, "utf8") }))
          match = candidates.find((c) => c.bytes <= maxBase64Bytes)
        } finally {
          resized.free()
        }

        if (match) {
          log.info("image resized", {
            command: "image-resize",
            status: "completed",
            originalBytes: base64Bytes,
            resultBytes: match.bytes,
            width: newW,
            height: newH,
          })
          return { resized: true, data: match.data, mime: match.mime, bytes: match.bytes }
        }

        scale *= 0.75
      }
    } finally {
      img.free()
    }

    log.warn("could not resize image to fit within limit", {
      command: "image-resize",
      status: "failed",
      originalBytes: base64Bytes,
      maxBase64Bytes,
    })
    return { resized: false, error: "too_large" }
  } catch (error) {
    log.warn("image resize failed", { command: "image-resize", status: "error", error })
    return { resized: false }
  }
}
