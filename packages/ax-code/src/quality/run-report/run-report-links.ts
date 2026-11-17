import { esc } from "./run-report-format"

type ReportLink = (path: string, label: string, query?: Record<string, string>) => string

/** Carry query context into escaped links. Each URL is local to one link, with no persistent collection growth. */
export function createReportLink(base: URLSearchParams): ReportLink {
  return (path, label, query) => {
    const url = new URL(path, "http://ax-code.local")
    for (const [key, value] of base.entries()) {
      url.searchParams.set(key, value) // @scan-suppress lifecycle_scan
    }
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value) // @scan-suppress lifecycle_scan
    }
    return `<a href="${esc(url.pathname + url.search)}">${esc(label)}</a>`
  }
}
