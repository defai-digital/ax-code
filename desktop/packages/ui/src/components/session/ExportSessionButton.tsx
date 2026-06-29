import React from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Icon } from "@/components/icon/Icon"
import { useI18n } from "@/lib/i18n"
import { useSessionUIStore } from "@/sync/session-ui-store"
import { useSession, useSessionMessagesResolved, buildSessionMessageRecordsSnapshot } from "@/sync/sync-context"
import { useDirectoryStore } from "@/sync/sync-context"
import {
  formatSessionAsMarkdown,
  saveAsMarkdownDesktop,
  buildExportFilename,
  downloadAsMarkdown,
} from "@/lib/exportSession"
import { isDesktopShell } from "@/lib/desktop"
import { toast } from "@/components/ui"

const DESKTOP_HEADER_ICON_BUTTON_CLASS =
  "app-region-no-drag inline-flex h-8 w-8 items-center justify-center gap-2 rounded-md typography-ui-label font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50 hover:bg-interactive-hover transition-colors"

export const ExportSessionButton: React.FC = React.memo(function ExportSessionButton() {
  const { t } = useI18n()
  const currentSessionId = useSessionUIStore((s) => s.currentSessionId)
  const session = useSession(currentSessionId)
  const isResolved = useSessionMessagesResolved(currentSessionId ?? "")
  const directoryStore = useDirectoryStore()

  const sessionTitle = session?.title || currentSessionId || ""

  const getExportRecords = React.useCallback(() => {
    if (!currentSessionId) return []
    return buildSessionMessageRecordsSnapshot(directoryStore.getState(), currentSessionId).list
  }, [currentSessionId, directoryStore])

  const handleExportMarkdown = React.useCallback(async () => {
    if (!currentSessionId) return
    const records = getExportRecords()
    if (records.length === 0) return

    try {
      const markdown = formatSessionAsMarkdown(records, sessionTitle)
      const filename = buildExportFilename(sessionTitle)

      if (isDesktopShell()) {
        const savedPath = await saveAsMarkdownDesktop(markdown, filename)
        if (savedPath) {
          toast.success(t("sessionExport.toast.saved"))
        }
      } else {
        downloadAsMarkdown(markdown, filename)
        toast.success(t("sessionExport.toast.saved"))
      }
    } catch {
      toast.error(t("sessionExport.toast.failed"))
    }
  }, [currentSessionId, getExportRecords, sessionTitle, t])

  const handleCopyClipboard = React.useCallback(async () => {
    if (!currentSessionId) return
    const records = getExportRecords()
    if (records.length === 0) return

    try {
      const markdown = formatSessionAsMarkdown(records, sessionTitle)
      await navigator.clipboard.writeText(markdown)
      toast.success(t("sessionExport.toast.copied"))
    } catch {
      toast.error(t("sessionExport.toast.failed"))
    }
  }, [currentSessionId, getExportRecords, sessionTitle, t])

  if (!isResolved) {
    return null
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={DESKTOP_HEADER_ICON_BUTTON_CLASS}
              aria-label={t("sessionExport.title")}
            >
              <Icon name="download" className="h-[18px] w-[18px]" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t("sessionExport.title")}</p>
          </TooltipContent>
        </Tooltip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleExportMarkdown}>
          <Icon name="file-text" className="mr-2 h-4 w-4" />
          {t("sessionExport.markdown")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopyClipboard}>
          <Icon name="clipboard" className="mr-2 h-4 w-4" />
          {t("sessionExport.copyClipboard")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
