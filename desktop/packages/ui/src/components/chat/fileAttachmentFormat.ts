/** Human-readable file size for attachment metadata. */
export function formatAttachedFileSize(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return ""
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  // Promote when 1-decimal KB would round to "1024.0 KB".
  if (kb < 1023.95) return `${kb.toFixed(1)} KB`
  const mb = bytes / (1024 * 1024)
  if (mb < 1023.95) return `${mb.toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
