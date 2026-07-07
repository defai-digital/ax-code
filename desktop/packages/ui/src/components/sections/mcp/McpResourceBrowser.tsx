import React from "react"
import type { McpReadResourceResult, McpResource } from "@ax-code/sdk/v2"

import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui"
import { Icon } from "@/components/icon/Icon"
import { copyTextToClipboard } from "@/lib/clipboard"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { useInputStore } from "@/sync/input-store"
import { useMcpStore } from "@/stores/useMcpStore"

const MAX_PREVIEW_CHARS = 12_000

type McpResourceBrowserProps = {
  serverName: string
  directory?: string | null
  connected: boolean
}

type ResourcePreview = {
  text: string
  truncated: boolean
  binaryOnly: boolean
}

export function resourcesForServer(resources: Record<string, McpResource>, serverName: string): McpResource[] {
  return Object.values(resources)
    .filter((resource) => resource.client === serverName)
    .sort((a, b) => {
      const byName = a.name.localeCompare(b.name)
      return byName === 0 ? a.uri.localeCompare(b.uri) : byName
    })
}

export function resourcePreview(result: McpReadResourceResult, binaryLabel: (mime: string) => string): ResourcePreview {
  const textParts: string[] = []
  const binaryParts: string[] = []

  for (const content of result.contents) {
    if ("text" in content && typeof content.text === "string") {
      textParts.push(content.text)
      continue
    }
    if ("blob" in content && typeof content.blob === "string") {
      binaryParts.push(binaryLabel(content.mimeType ?? "application/octet-stream"))
    }
  }

  const fullText = textParts.length > 0 ? textParts.join("\n\n") : binaryParts.join("\n")
  if (fullText.length <= MAX_PREVIEW_CHARS) {
    return { text: fullText, truncated: false, binaryOnly: textParts.length === 0 && binaryParts.length > 0 }
  }

  return {
    text: fullText.slice(0, MAX_PREVIEW_CHARS),
    truncated: true,
    binaryOnly: textParts.length === 0 && binaryParts.length > 0,
  }
}

export const McpResourceBrowser: React.FC<McpResourceBrowserProps> = ({ serverName, directory, connected }) => {
  const { t } = useI18n()
  const resources = useMcpStore((state) => state.getResourcesForDirectory(directory ?? null))
  const resourceError = useMcpStore((state) => state.getResourceErrorForDirectory(directory ?? null))
  const refreshResources = useMcpStore((state) => state.refreshResources)
  const readResource = useMcpStore((state) => state.readResource)
  const addMcpResourceAttachment = useInputStore((state) => state.addMcpResourceAttachment)
  const [selectedUri, setSelectedUri] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<ResourcePreview | null>(null)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [isReading, setIsReading] = React.useState(false)

  const serverResources = React.useMemo(() => resourcesForServer(resources, serverName), [resources, serverName])
  const selectedResource = React.useMemo(
    () => serverResources.find((resource) => resource.uri === selectedUri) ?? null,
    [selectedUri, serverResources],
  )

  React.useEffect(() => {
    setSelectedUri(null)
    setPreview(null)
    setPreviewError(null)
  }, [serverName, directory])

  React.useEffect(() => {
    if (!connected) return
    void refreshResources({ directory, silent: true })
  }, [connected, directory, refreshResources])

  const handleRefresh = React.useCallback(async () => {
    if (!connected || isRefreshing) return
    setIsRefreshing(true)
    try {
      await refreshResources({ directory })
    } finally {
      setIsRefreshing(false)
    }
  }, [connected, directory, isRefreshing, refreshResources])

  const handleSelectResource = React.useCallback(
    async (resource: McpResource) => {
      setSelectedUri(resource.uri)
      setPreview(null)
      setPreviewError(null)
      setIsReading(true)
      try {
        const result = await readResource(resource.client, resource.uri, directory)
        setPreview(resourcePreview(result, (mime) => t("settings.mcp.page.resources.preview.binary", { mime })))
      } catch (error) {
        const message = error instanceof Error ? error.message : t("settings.mcp.page.resources.preview.readFailed")
        setPreviewError(message)
      } finally {
        setIsReading(false)
      }
    },
    [directory, readResource, t],
  )

  const handleCopy = React.useCallback(
    async (
      text: string,
      successKey: "settings.mcp.page.toast.resourceTextCopied" | "settings.mcp.page.toast.resourceUriCopied",
    ) => {
      const result = await copyTextToClipboard(text)
      if (result.ok) {
        toast.success(t(successKey))
      } else {
        toast.error(result.error)
      }
    },
    [t],
  )

  const handleAddToComposer = React.useCallback(
    (resource: McpResource) => {
      addMcpResourceAttachment(resource)
      toast.success(t("settings.mcp.page.toast.resourceAddedToComposer"))
    },
    [addMcpResourceAttachment, t],
  )

  return (
    <div className="mb-6">
      <div className="mb-1 flex items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <h3 className="typography-ui-header font-medium text-foreground">
            {t("settings.mcp.page.resources.title")}
            {serverResources.length > 0 && (
              <span className="ml-1.5 typography-micro text-muted-foreground font-normal">
                ({serverResources.length})
              </span>
            )}
          </h3>
        </div>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
          disabled={!connected || isRefreshing}
          onClick={() => void handleRefresh()}
          aria-label={t("settings.mcp.page.resources.refreshAria")}
          title={t("settings.mcp.page.resources.refreshTitle")}
        >
          <Icon name="refresh" className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
        </button>
      </div>

      <section className="rounded-lg border border-[var(--interactive-border)] bg-[var(--surface-elevated)]">
        {!connected ? (
          <div className="px-3 py-4 typography-meta text-muted-foreground">
            {t("settings.mcp.page.resources.connectFirst")}
          </div>
        ) : resourceError ? (
          <div className="px-3 py-4 typography-meta text-[var(--status-error)]">{resourceError}</div>
        ) : serverResources.length === 0 ? (
          <div className="px-3 py-4 typography-meta text-muted-foreground">
            {isRefreshing ? t("settings.mcp.page.resources.loading") : t("settings.mcp.page.resources.empty")}
          </div>
        ) : (
          <div className="grid min-h-[220px] gap-0 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="max-h-[320px] overflow-y-auto border-b border-[var(--interactive-border)] p-2 md:border-b-0 md:border-r">
              <div className="space-y-1">
                {serverResources.map((resource) => {
                  const selected = resource.uri === selectedUri
                  return (
                    <button
                      key={`${resource.client}:${resource.uri}`}
                      type="button"
                      className={cn(
                        "w-full rounded-md px-2 py-2 text-left transition-colors",
                        selected ? "bg-interactive-selection" : "hover:bg-interactive-hover",
                      )}
                      onClick={() => void handleSelectResource(resource)}
                    >
                      <div className="flex items-start gap-2">
                        <Icon name="file-text" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate typography-ui-label text-foreground">{resource.name}</div>
                          <div className="truncate typography-micro font-mono text-muted-foreground">
                            {resource.uri}
                          </div>
                          {resource.mimeType && (
                            <div className="mt-0.5 typography-micro text-muted-foreground/80">{resource.mimeType}</div>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="min-w-0 p-3">
              {selectedResource ? (
                <div className="flex h-full min-h-[200px] flex-col gap-2">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate typography-ui-label text-foreground">{selectedResource.name}</div>
                      <div className="break-all typography-micro font-mono text-muted-foreground">
                        {selectedResource.uri}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 px-0 text-muted-foreground"
                        title={t("settings.mcp.page.resources.addToComposerTitle")}
                        onClick={() => handleAddToComposer(selectedResource)}
                      >
                        <Icon name="add" className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 px-0 text-muted-foreground"
                        title={t("settings.mcp.page.resources.copyUriTitle")}
                        onClick={() =>
                          void handleCopy(selectedResource.uri, "settings.mcp.page.toast.resourceUriCopied")
                        }
                      >
                        <Icon name="clipboard" className="h-3.5 w-3.5" />
                      </Button>
                      {preview?.text && !preview.binaryOnly && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 px-0 text-muted-foreground"
                          title={t("settings.mcp.page.resources.copyTextTitle")}
                          onClick={() => void handleCopy(preview.text, "settings.mcp.page.toast.resourceTextCopied")}
                        >
                          <Icon name="file-copy" className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {isReading ? (
                    <div className="flex flex-1 items-center justify-center typography-meta text-muted-foreground">
                      {t("settings.mcp.page.resources.preview.loading")}
                    </div>
                  ) : previewError ? (
                    <div className="rounded-md border border-[var(--status-error-border)] bg-[var(--status-error-background)] px-3 py-2 typography-meta text-[var(--status-error)]">
                      {previewError}
                    </div>
                  ) : preview ? (
                    <div className="min-h-0 flex-1">
                      <pre className="max-h-[240px] overflow-auto rounded-md bg-[var(--surface-background)] p-3 font-mono text-xs leading-5 text-foreground whitespace-pre-wrap">
                        {preview.text || t("settings.mcp.page.resources.preview.empty")}
                      </pre>
                      {preview.truncated && (
                        <div className="mt-1 typography-micro text-muted-foreground">
                          {t("settings.mcp.page.resources.preview.truncated")}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-1 items-center justify-center typography-meta text-muted-foreground">
                      {t("settings.mcp.page.resources.preview.none")}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex h-full min-h-[200px] items-center justify-center typography-meta text-muted-foreground">
                  {t("settings.mcp.page.resources.preview.none")}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
