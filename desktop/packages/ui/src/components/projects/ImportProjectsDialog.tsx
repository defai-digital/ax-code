import React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollableOverlay } from "@/components/ui/ScrollableOverlay"
import { Icon } from "@/components/icon/Icon"
import { toast } from "@/components/ui"
import { useI18n } from "@/lib/i18n"
import { API_ENDPOINTS } from "@/lib/http"
import { useProjectsStore } from "@/stores/useProjectsStore"
import { cn } from "@/lib/utils"

type ExternalCandidate = {
  root: string
  name: string
  source: "codex" | "kimi" | "both" | string
  sources?: string[]
  trustLevel?: string | null
  lastOpenedAt?: number | null
  exists: boolean
  alreadyImported: boolean
}

type DiscoverResponse = {
  candidates?: ExternalCandidate[]
  sources?: {
    codex?: { found?: boolean; count?: number }
    kimi?: { found?: boolean; count?: number }
  }
  error?: string
}

type ImportProjectsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const sourceLabel = (source: string, t: (key: string, params?: Record<string, string | number>) => string): string => {
  if (source === "codex") return t("projects.import.source.codex")
  if (source === "kimi") return t("projects.import.source.kimi")
  if (source === "both") return t("projects.import.source.both")
  return source
}

export const ImportProjectsDialog: React.FC<ImportProjectsDialogProps> = ({ open, onOpenChange }) => {
  const { t } = useI18n()
  const addProjects = useProjectsStore((state) => state.addProjects)
  const [loading, setLoading] = React.useState(false)
  const [importing, setImporting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [candidates, setCandidates] = React.useState<ExternalCandidate[]>([])
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [sourceSummary, setSourceSummary] = React.useState<string>("")

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(API_ENDPOINTS.projects.discoverExternal, {
        method: "GET",
        headers: { Accept: "application/json" },
      })
      const payload = (await response.json().catch(() => null)) as DiscoverResponse | null
      if (!response.ok) {
        throw new Error(payload?.error || t("projects.import.error.loadFailed"))
      }

      const list = Array.isArray(payload?.candidates) ? payload.candidates : []
      setCandidates(list)

      const codexFound = payload?.sources?.codex?.found === true
      const kimiFound = payload?.sources?.kimi?.found === true
      const parts: string[] = []
      if (codexFound) {
        parts.push(t("projects.import.summary.codex", { count: payload?.sources?.codex?.count ?? 0 }))
      }
      if (kimiFound) {
        parts.push(t("projects.import.summary.kimi", { count: payload?.sources?.kimi?.count ?? 0 }))
      }
      setSourceSummary(parts.join(" · "))

      const importable = list.filter((entry) => entry.exists && !entry.alreadyImported)
      setSelected(new Set(importable.map((entry) => entry.root)))
    } catch (err) {
      const message = err instanceof Error ? err.message : t("projects.import.error.loadFailed")
      setError(message)
      setCandidates([])
      setSelected(new Set())
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    if (!open) {
      return
    }
    void load()
  }, [open, load])

  const importableCandidates = React.useMemo(
    () => candidates.filter((entry) => entry.exists && !entry.alreadyImported),
    [candidates],
  )

  const toggle = React.useCallback((root: string, enabled: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (enabled) next.add(root)
      else next.delete(root)
      return next
    })
  }, [])

  const selectAllImportable = React.useCallback(() => {
    setSelected(new Set(importableCandidates.map((entry) => entry.root)))
  }, [importableCandidates])

  const clearSelection = React.useCallback(() => {
    setSelected(new Set())
  }, [])

  const handleImport = React.useCallback(async () => {
    const paths = importableCandidates.filter((entry) => selected.has(entry.root)).map((entry) => entry.root)
    if (paths.length === 0) {
      return
    }

    const labels: Record<string, string> = {}
    for (const entry of importableCandidates) {
      if (selected.has(entry.root) && entry.name) {
        labels[entry.root] = entry.name
      }
    }

    setImporting(true)
    try {
      const added = addProjects(paths, { labels, activateFirst: true })
      if (added.length === 0) {
        toast.info(t("projects.import.toast.noneAdded"))
      } else {
        toast.success(t("projects.import.toast.added", { count: added.length }))
      }
      onOpenChange(false)
    } finally {
      setImporting(false)
    }
  }, [addProjects, importableCandidates, onOpenChange, selected, t])

  const selectedCount = importableCandidates.filter((entry) => selected.has(entry.root)).length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="border-b border-border/50 px-5 py-4">
          <DialogTitle>{t("projects.import.title")}</DialogTitle>
          <DialogDescription>{t("projects.import.description")}</DialogDescription>
          {sourceSummary ? <p className="typography-micro text-muted-foreground pt-1">{sourceSummary}</p> : null}
        </DialogHeader>

        <div className="px-5 py-3">
          {loading ? (
            <div className="py-10 text-center typography-meta text-muted-foreground">{t("common.loading")}</div>
          ) : error ? (
            <div className="space-y-3 py-6 text-center">
              <p className="typography-meta text-destructive">{error}</p>
              <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
                {t("projects.import.actions.retry")}
              </Button>
            </div>
          ) : candidates.length === 0 ? (
            <div className="py-10 text-center typography-meta text-muted-foreground">
              {t("projects.import.empty")}
            </div>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="typography-micro text-muted-foreground">
                  {t("projects.import.selectedCount", { count: selectedCount })}
                </span>
                <div className="flex items-center gap-1">
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={selectAllImportable}>
                    {t("projects.import.actions.selectAll")}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={clearSelection}>
                    {t("projects.import.actions.clear")}
                  </Button>
                </div>
              </div>
              <ScrollableOverlay className="max-h-[min(50vh,22rem)] space-y-1 pr-1">
                {candidates.map((entry) => {
                  const disabled = !entry.exists || entry.alreadyImported
                  const checked = selected.has(entry.root)
                  return (
                    <label
                      key={entry.root}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-md border border-transparent px-2 py-2 transition-colors",
                        disabled ? "cursor-default opacity-60" : "hover:bg-interactive-hover",
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={disabled}
                        onChange={(value) => toggle(entry.root, value === true)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate typography-ui-label font-medium text-foreground">{entry.name}</span>
                          <span className="rounded bg-muted px-1.5 py-0.5 typography-micro text-muted-foreground">
                            {sourceLabel(entry.source, t as (key: string, params?: Record<string, string | number>) => string)}
                          </span>
                          {entry.alreadyImported ? (
                            <span className="typography-micro text-muted-foreground">
                              {t("projects.import.badge.imported")}
                            </span>
                          ) : !entry.exists ? (
                            <span className="typography-micro text-destructive">
                              {t("projects.import.badge.missing")}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block truncate typography-micro text-muted-foreground">
                          {entry.root}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </ScrollableOverlay>
            </>
          )}
        </div>

        <DialogFooter className="border-t border-border/50 px-5 py-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={importing}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={() => void handleImport()} disabled={importing || selectedCount === 0}>
            {importing ? (
              t("common.loading")
            ) : (
              <>
                <Icon name="download-cloud" className="mr-1.5 h-3.5 w-3.5" />
                {t("projects.import.actions.import", { count: selectedCount })}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
