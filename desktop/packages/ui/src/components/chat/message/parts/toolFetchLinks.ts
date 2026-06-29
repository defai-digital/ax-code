import { isSafeExternalUrl } from "@/lib/url"

export const getSafeToolFetchHref = (url: string): string | undefined => {
  const trimmed = url.trim()
  if (!trimmed) {
    return undefined
  }
  return isSafeExternalUrl(trimmed) ? trimmed : undefined
}
