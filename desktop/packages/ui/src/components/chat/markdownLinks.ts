import { isSafeExternalUrl } from "@/lib/url"

export const getSafeMarkdownHref = (href: string | undefined): string | undefined => {
  if (!href) {
    return undefined
  }
  return isSafeExternalUrl(href) ? href : undefined
}
