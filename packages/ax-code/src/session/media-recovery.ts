import { maybeResizeImage, type ImageResizeConfig, type ResizeResult } from "./image-resize"
import type { MessageV2 } from "./message-v2"
import type { MediaProjection } from "./media-projection"
import type { MessageID } from "./schema"

// Recovery budgets cover the combined base64 image payload, leaving room for
// text and tool schemas. A provider can still impose a smaller request limit.
const IMAGE_BUDGET = { degraded: 1024 * 1024, stripped: 512 * 1024 }
const MAX_IMAGE_BYTES = 50 * 1024 * 1024
const resized = new WeakMap<MessageV2.FilePart, { url: string; key: string; result: Promise<ResizeResult> }>()

/** Reduce request copies only; never overwrite the user's original attachments. */
export async function recoverUserImages(input: {
  messages: MessageV2.WithParts[]
  userID: MessageID
  mode: MediaProjection.Mode
  config?: ImageResizeConfig
}) {
  if (input.mode === "normal" || input.config?.auto_resize === false) return input.messages
  const user = input.messages.find((message) => message.info.role === "user" && message.info.id === input.userID)
  if (!user) return input.messages
  const images = user.parts.filter(
    (part): part is MessageV2.FilePart => part.type === "file" && /^image\/(png|jpeg|webp)$/i.test(part.mime),
  )
  if (images.length === 0) return input.messages
  const config = {
    ...input.config,
    max_base64_bytes: Math.min(
      input.config?.max_base64_bytes ?? Infinity,
      Math.max(1, Math.floor(IMAGE_BUDGET[input.mode] / images.length)),
    ),
  }
  const key = JSON.stringify(config)
  const replacements = new Map<MessageV2.FilePart, MessageV2.FilePart>()
  // Decode sequentially to avoid multiplying peak WASM memory by image count.
  for (const part of images) {
    const comma = part.url.indexOf(",")
    if (!/^data:image\/(png|jpeg|webp);base64$/i.test(part.url.slice(0, comma))) continue
    const data = part.url.slice(comma + 1)
    if (data.length <= config.max_base64_bytes || data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) continue
    let cached = resized.get(part)
    if (!cached || cached.url !== part.url || cached.key !== key) {
      cached = {
        url: part.url,
        key,
        result: maybeResizeImage({ buffer: Buffer.from(data, "base64"), mime: part.mime, config }),
      }
      // At most one recovery variant per live source part. A mutated plugin
      // draft or changed config cannot reuse a stale image conversion.
      resized.set(part, cached)
    }
    const result = await cached.result
    if (!result.resized) continue
    const url = `data:${result.mime};base64,${result.data}`
    if (url.length < part.url.length) replacements.set(part, { ...part, mime: result.mime, url })
  }
  if (replacements.size === 0) return input.messages
  return input.messages.map((message) =>
    message === user
      ? {
          ...message,
          parts: message.parts.map((part) => (part.type === "file" ? (replacements.get(part) ?? part) : part)),
        }
      : message,
  )
}
