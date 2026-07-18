import React, { useCallback, useMemo } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { ScrollableOverlay } from "@/components/ui/ScrollableOverlay"
import { SimpleMarkdownRenderer } from "@/components/chat/MarkdownRenderer"
import { Icon } from "@/components/icon/Icon"
import type { UpdateInfo, UpdateProgress } from "@/lib/desktop"
import { openExternalUrl } from "@/lib/url"
import { useI18n } from "@/lib/i18n"
import { buildUpdateReleaseUrl, normalizeReleaseNotesForMarkdown } from "./updateReleaseNotes"

interface UpdateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  info: UpdateInfo | null
  downloading: boolean
  downloaded: boolean
  progress: UpdateProgress | null
  error: string | null
  onDownload: () => void
  onRestart: () => void
}

type ChangelogSection = {
  version: string
  date: string
  start: number
  end: number
  raw: string
}

type ParsedChangelog =
  | {
      kind: "raw"
      title: string
      content: string
    }
  | {
      kind: "sections"
      title: string
      sections: Array<{ version: string; dateLabel: string; content: string }>
    }

function formatIsoDateForUI(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(d.getTime())) {
    return isoDate
  }
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d)
}

function stripChangelogHeading(sectionRaw: string): string {
  return sectionRaw.replace(/^## \[[^\]]+\] - \d{4}-\d{2}-\d{2}\s*\n?/, "").trim()
}

function processChangelogMentions(content: string): string {
  // Convert @username to markdown links so they can be styled via css
  return content.replace(/(^|[^a-zA-Z0-9])@([a-zA-Z0-9-]+)/g, "$1[@$2](https://github.com/$2)")
}

function compareSemverDesc(a: string, b: string): number {
  const pa = a.split(".").map((v) => Number.parseInt(v, 10))
  const pb = b.split(".").map((v) => Number.parseInt(v, 10))
  for (let i = 0; i < 3; i += 1) {
    const da = Number.isFinite(pa[i]) ? (pa[i] as number) : 0
    const db = Number.isFinite(pb[i]) ? (pb[i] as number) : 0
    if (da !== db) {
      return db - da
    }
  }
  return 0
}

function parseChangelogSections(body: string): ChangelogSection[] {
  const re = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})\s*$/gm
  const matches: Array<{ version: string; date: string; start: number }> = []

  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    matches.push({
      version: m[1] ?? "",
      date: m[2] ?? "",
      start: m.index,
    })
  }

  if (matches.length === 0) {
    return []
  }

  return matches.map((match, idx) => {
    const end = matches[idx + 1]?.start ?? body.length
    const raw = body.slice(match.start, end).trim()
    return { version: match.version, date: match.date, start: match.start, end, raw }
  })
}

export const UpdateDialog: React.FC<UpdateDialogProps> = ({
  open,
  onOpenChange,
  info,
  downloading,
  downloaded,
  progress,
  error,
  onDownload,
  onRestart,
}) => {
  const { t } = useI18n()

  const releaseUrl = buildUpdateReleaseUrl(info?.version)

  const progressPercent = progress?.total ? Math.round((progress.downloaded / progress.total) * 100) : 0

  const handleOpenExternal = useCallback(async (url: string) => {
    await openExternalUrl(url)
  }, [])

  const changelog = useMemo<ParsedChangelog | null>(() => {
    if (!info?.body) {
      return null
    }

    const body = normalizeReleaseNotesForMarkdown(info.body.trim())
    if (!body) {
      return null
    }

    const sections = parseChangelogSections(body)

    if (sections.length === 0) {
      return {
        kind: "raw",
        title: t("updateDialog.changelog.title"),
        content: processChangelogMentions(body),
      }
    }

    const sorted = [...sections].sort((a, b) => compareSemverDesc(a.version, b.version))
    return {
      kind: "sections",
      title: t("updateDialog.changelog.title"),
      sections: sorted.map((section) => ({
        version: section.version,
        dateLabel: formatIsoDateForUI(section.date),
        content: processChangelogMentions(stripChangelogHeading(section.raw) || body),
      })),
    }
  }, [info?.body, t])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-5 bg-background border-[var(--interactive-border)]" showCloseButton={true}>
        {/* Header Section */}
        <div className="flex items-center mb-1">
          <DialogTitle className="flex items-center gap-2.5">
            <Icon name="download-cloud" className="h-5 w-5 text-[var(--primary-base)]" />
            <span className="text-lg font-semibold text-foreground">
              {t("updateDialog.header.updateAvailable")}
            </span>
          </DialogTitle>

          {/* Version Diff */}
          {(info?.currentVersion || info?.version) && (
            <div className="flex items-center gap-2 font-mono typography-ui-label ml-3">
              {info?.currentVersion && <span className="text-muted-foreground">{info.currentVersion}</span>}
              {info?.currentVersion && info?.version && <span className="text-muted-foreground">→</span>}
              {info?.version && <span className="text-[var(--primary-base)] font-medium">{info.version}</span>}
            </div>
          )}
        </div>

        {/* Content Body */}
        <div className="space-y-2">
          {/* Changelog Rendering */}
          {changelog && (
            <div className="rounded-lg border border-[var(--surface-subtle)] bg-[var(--surface-elevated)]/20 overflow-hidden">
              <ScrollableOverlay className="max-h-[400px] p-0" fillContainer={false}>
                {changelog.kind === "raw" ? (
                  <div
                    className="p-4 typography-markdown-body text-foreground leading-relaxed break-words [&_a]:!text-[var(--primary-base)] [&_a]:!no-underline [&_a:hover]:!underline"
                    onClickCapture={(e) => {
                      const target = e.target as HTMLElement
                      const a = target.closest("a")
                      if (a && a.href) {
                        e.preventDefault()
                        e.stopPropagation()
                        void handleOpenExternal(a.href)
                      }
                    }}
                  >
                    <SimpleMarkdownRenderer content={changelog.content} disableLinkSafety={true} />
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--surface-subtle)]">
                    {changelog.sections.map((section) => (
                      <div key={section.version} className="p-4">
                        <div className="flex items-center gap-3 mb-3">
                          <span className="typography-ui-label font-mono text-[var(--primary-base)] bg-[var(--primary-base)]/10 px-1.5 py-0.5 rounded">
                            v{section.version}
                          </span>
                          <span className="typography-ui-label font-medium text-muted-foreground">{section.dateLabel}</span>
                        </div>
                        <div
                          className="typography-markdown-body text-foreground leading-relaxed break-words [&_a]:!text-[var(--primary-base)] [&_a]:!no-underline [&_a:hover]:!underline"
                          onClickCapture={(e) => {
                            const target = e.target as HTMLElement
                            const a = target.closest("a")
                            if (a && a.href) {
                              e.preventDefault()
                              e.stopPropagation()
                              void handleOpenExternal(a.href)
                            }
                          }}
                        >
                          <SimpleMarkdownRenderer content={section.content} disableLinkSafety={true} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollableOverlay>
            </div>
          )}

          {/* Desktop progress bar */}
          {downloading && (
            <div className="space-y-2 mt-4">
              <div className="flex items-center justify-between typography-ui-label">
                <span className="text-muted-foreground">{t("updateDialog.status.downloadingPayload")}</span>
                <span className="font-mono text-foreground">{progressPercent}%</span>
              </div>
              <div className="h-1.5 bg-[var(--surface-subtle)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--primary-base)] transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="p-3 mt-4 bg-[var(--status-error-background)] border border-[var(--status-error-border)] rounded-lg">
              <p className="typography-ui-label text-[var(--status-error)]">{error}</p>
            </div>
          )}
        </div>

        {/* Action Footer */}
        <div className="mt-4 flex items-center justify-between gap-4">
          <a
            href={releaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 typography-ui-label text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <Icon name="external-link" className="h-4 w-4" />
            GitHub
          </a>

          <div className="flex-1 flex justify-end">
            {!downloaded && !downloading && (
              <button
                onClick={onDownload}
                className="flex items-center justify-center gap-2 px-5 py-2 rounded-md typography-ui-label font-medium bg-[var(--primary-base)] text-[var(--primary-foreground)] hover:opacity-90 transition-opacity"
              >
                <Icon name="download" className="h-4 w-4" />
                {t("updateDialog.actions.downloadUpdate")}
              </button>
            )}

            {downloading && (
              <button
                disabled
                className="flex items-center justify-center gap-2 px-5 py-2 rounded-md typography-ui-label font-medium bg-[var(--primary-base)]/50 text-[var(--primary-foreground)] cursor-not-allowed"
              >
                <Icon name="loader" className="h-4 w-4 animate-spin" />
                {t("updateDialog.status.downloading")}
              </button>
            )}

            {downloaded && (
              <button
                onClick={onRestart}
                className="flex items-center justify-center gap-2 px-5 py-2 rounded-md typography-ui-label font-medium bg-[var(--status-success)] text-white hover:opacity-90 transition-opacity"
              >
                <Icon name="restart" className="h-4 w-4" />
                {t("updateDialog.actions.restartToUpdate")}
              </button>
            )}

          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
