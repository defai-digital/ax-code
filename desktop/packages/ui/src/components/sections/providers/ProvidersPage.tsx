import React from "react"
import { ScrollableOverlay } from "@/components/ui/ScrollableOverlay"
import { ViewLoadingSkeleton } from "@/components/ui/ViewLoadingSkeleton"
import { ProviderLogo } from "@/components/ui/ProviderLogo"
import { useConfigStore } from "@/stores/useConfigStore"
import { useProjectsStore } from "@/stores/useProjectsStore"
import { useUIStore } from "@/stores/useUIStore"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { toast } from "@/components/ui"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Icon } from "@/components/icon/Icon"
import type { IconName } from "@/components/icon/icons"
import { API_ENDPOINTS, replacePathParams } from "@/lib/http"
import {
  buildDirectoryUrl,
  disconnectProviderAuth,
  fetchAvailableProviders,
  fetchProviderAuthMethods,
  fetchProviderJsonWithRetry,
  fetchProviderSources,
  getCurrentDirectory,
  isCliProvider,
  isLocalProvider,
  isRecord,
  isRestartingError,
  normalizeAuthType,
  parseAuthMethodsPayload,
  parseAvailableProvidersPayload,
  PROVIDER_RESTART_POLL_MS,
  saveProviderAuth,
  connectPrivateGpu,
  dedicatedPrivateGpuVendor,
  isDedicatedPrivateGpuProvider,
  type AuthMethod,
  type ProviderOption,
} from "@/lib/ax-code/providerApi"
import { reloadAxCodeConfiguration, waitForQueuedAxCodeReload } from "@/stores/useAgentsStore"
import { cn } from "@/lib/utils"
import { copyTextToClipboard } from "@/lib/clipboard"
import { openExternalUrl } from "@/lib/url"
import type { ModelMetadata } from "@/types"
import { useI18n } from "@/lib/i18n"
import type { ProviderSources } from "./types"
import {
  cancelAxEngineModelDownload,
  fetchAxEngineModels,
  startAxEngineModelDownload,
  type AxEngineModelCatalogEntry,
  type AxEngineModelJobSummary,
  type AxEngineModelsResponse,
} from "@/lib/ax-code/axEngineModelsApi"
import { downloadToastTracker } from "@/lib/ax-code/axEngineDownloadToasts"

const AX_ENGINE_PROVIDER_ID = "ax-engine"

const COMPACT_NUMBER_FORMATTER = new Intl.NumberFormat("en-US", {
  notation: "compact",
  compactDisplay: "short",
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
})

const formatTokens = (value?: number | null) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null
  }
  if (value === 0) {
    return "0"
  }
  const formatted = COMPACT_NUMBER_FORMATTER.format(value)
  return formatted.endsWith(".0") ? formatted.slice(0, -2) : formatted
}

const ADD_PROVIDER_ID = "__add_provider__"
const PROVIDER_RESTART_POLL_MAX_MS = 30_000

export const ProvidersPage: React.FC = () => {
  const { t } = useI18n()
  const providers = useConfigStore((state) => state.providers)
  const providersLoading = useConfigStore((state) => state.providersLoading)
  const providersError = useConfigStore((state) => state.providersError)
  const loadProviders = useConfigStore((state) => state.loadProviders)
  const selectedProviderId = useConfigStore((state) => state.selectedProviderId)
  const setSelectedProvider = useConfigStore((state) => state.setSelectedProvider)
  const getModelMetadata = useConfigStore((state) => state.getModelMetadata)
  const hiddenModels = useUIStore((state) => state.hiddenModels)
  const toggleHiddenModel = useUIStore((state) => state.toggleHiddenModel)
  const hideAllModels = useUIStore((state) => state.hideAllModels)
  const showAllModels = useUIStore((state) => state.showAllModels)
  const activeProjectId = useProjectsStore((state) => state.activeProjectId)
  const directory = React.useMemo(() => {
    void activeProjectId
    return getCurrentDirectory()
  }, [activeProjectId])

  const [authMethodsByProvider, setAuthMethodsByProvider] = React.useState<Record<string, AuthMethod[]>>({})
  const [authLoading, setAuthLoading] = React.useState(false)
  const [apiKeyInputs, setApiKeyInputs] = React.useState<Record<string, string>>({})
  const [privateGpuEndpointInputs, setPrivateGpuEndpointInputs] = React.useState<Record<string, string>>({})
  const [authBusyKey, setAuthBusyKey] = React.useState<string | null>(null)
  const [modelQuery, setModelQuery] = React.useState("")
  const [pendingOAuth, setPendingOAuth] = React.useState<{ providerId: string; methodIndex: number } | null>(null)
  const [oauthCodes, setOauthCodes] = React.useState<Record<string, string>>({})
  const [oauthDetails, setOauthDetails] = React.useState<
    Record<string, { url?: string; instructions?: string; userCode?: string }>
  >({})
  const [availableProviders, setAvailableProviders] = React.useState<ProviderOption[]>([])
  const [availableLoading, setAvailableLoading] = React.useState(false)
  const [availableError, setAvailableError] = React.useState<string | null>(null)
  const [candidateProviderId, setCandidateProviderId] = React.useState("")
  const [providerSearchQuery, setProviderSearchQuery] = React.useState("")
  const [providerDropdownOpen, setProviderDropdownOpen] = React.useState(false)
  const [providerSources, setProviderSources] = React.useState<Record<string, ProviderSources>>({})
  // Start collapsed; selecting a different provider re-collapses so Connect/
  // Reconnect is always one click away from the "Connected" summary row.
  const [showAuthPanel, setShowAuthPanel] = React.useState(false)
  // Local AX Engine catalog (download status / jobs). Only loaded when the
  // selected provider is ax-engine so Providers can start weight downloads.
  const [axEngineCatalog, setAxEngineCatalog] = React.useState<AxEngineModelsResponse | null>(null)
  const [axEngineBusyKey, setAxEngineBusyKey] = React.useState<string | null>(null)
  const axEngineInFlightRef = React.useRef(false)

  React.useEffect(() => {
    setShowAuthPanel(false)
  }, [selectedProviderId])

  const loadAxEngineCatalog = React.useCallback(async () => {
    if (axEngineInFlightRef.current) return
    axEngineInFlightRef.current = true
    try {
      const next = await fetchAxEngineModels(directory)
      setAxEngineCatalog(next)
      downloadToastTracker.reconcile(next.jobs)
    } catch (error) {
      console.error("Failed to load AX Engine model catalog:", error)
    } finally {
      axEngineInFlightRef.current = false
    }
  }, [directory])

  React.useEffect(() => {
    if (selectedProviderId !== AX_ENGINE_PROVIDER_ID) {
      setAxEngineCatalog(null)
      return
    }
    void loadAxEngineCatalog()
  }, [selectedProviderId, loadAxEngineCatalog])

  const axEngineHasActiveJob =
    axEngineCatalog?.jobs.some((job) => job.status === "queued" || job.status === "running") ?? false
  React.useEffect(() => {
    if (selectedProviderId !== AX_ENGINE_PROVIDER_ID || !axEngineHasActiveJob) return
    const timer = window.setInterval(() => void loadAxEngineCatalog(), 2000)
    return () => window.clearInterval(timer)
  }, [selectedProviderId, axEngineHasActiveJob, loadAxEngineCatalog])

  const axEngineEntryById = React.useMemo(() => {
    const map = new Map<string, AxEngineModelCatalogEntry>()
    for (const model of axEngineCatalog?.models ?? []) map.set(model.id, model)
    return map
  }, [axEngineCatalog])

  const axEngineActiveJob = (modelId: string): AxEngineModelJobSummary | undefined =>
    axEngineCatalog?.jobs.find(
      (job) =>
        job.modelID === modelId && (job.status === "queued" || job.status === "running"),
    )

  const handleAxEngineDownload = async (modelId: string, modelName: string) => {
    setAxEngineBusyKey(modelId)
    try {
      const job = await startAxEngineModelDownload(modelId, directory)
      downloadToastTracker.announce(job, modelName, directory)
      await loadAxEngineCatalog()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("localModels.toast.downloadStartFailed"))
    } finally {
      setAxEngineBusyKey(null)
    }
  }

  const handleAxEngineCancel = async (job: AxEngineModelJobSummary) => {
    setAxEngineBusyKey(job.id)
    try {
      const result = await cancelAxEngineModelDownload(job.id, directory)
      if (result?.status === "complete") toast.success(t("localModels.toast.downloadAlreadyFinished"))
      else toast.success(t("localModels.toast.downloadCancelled"))
      await loadAxEngineCatalog()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("localModels.toast.actionFailed"))
    } finally {
      setAxEngineBusyKey(null)
    }
  }

  React.useEffect(() => {
    if (!selectedProviderId && providers.length > 0) {
      setSelectedProvider(providers[0].id)
    }
  }, [providers, selectedProviderId, setSelectedProvider])

  React.useEffect(() => {
    let isMounted = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const pollStartedAt = Date.now()

    const loadAuthMethods = async () => {
      setAuthLoading(true)
      try {
        const payload = await fetchProviderAuthMethods(directory)
        if (!isMounted) return
        setAuthMethodsByProvider(parseAuthMethodsPayload(payload))
        setAuthLoading(false)
      } catch (error) {
        if (!isMounted) return
        if (isRestartingError(error)) {
          if (Date.now() - pollStartedAt >= PROVIDER_RESTART_POLL_MAX_MS) {
            console.error("Timed out waiting for provider auth methods while AX Code was restarting:", error)
            toast.error(t("settings.providers.page.toast.authMethodsLoadFailed"))
            setAuthLoading(false)
            return
          }
          // Engine still starting — keep loading and poll instead of erroring.
          retryTimer = setTimeout(loadAuthMethods, PROVIDER_RESTART_POLL_MS)
          return
        }
        console.error("Failed to load provider auth methods:", error)
        toast.error(t("settings.providers.page.toast.authMethodsLoadFailed"))
        setAuthLoading(false)
      }
    }

    loadAuthMethods()

    return () => {
      isMounted = false
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [directory, t])

  React.useEffect(() => {
    let isMounted = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const pollStartedAt = Date.now()

    const loadAvailableProviders = async () => {
      setAvailableLoading(true)
      setAvailableError(null)
      try {
        const payload = await fetchAvailableProviders(directory)
        if (!isMounted) return
        setAvailableProviders(parseAvailableProvidersPayload(payload))
        setAvailableLoading(false)
      } catch (error) {
        if (!isMounted) return
        if (isRestartingError(error)) {
          if (Date.now() - pollStartedAt >= PROVIDER_RESTART_POLL_MAX_MS) {
            console.error("Timed out waiting for available providers while AX Code was restarting:", error)
            setAvailableError(t("settings.providers.page.state.unableToLoadProviderList"))
            setAvailableLoading(false)
            return
          }
          // Engine still starting — keep loading and poll so the "Connect
          // Provider" list populates once it is up instead of dead-ending.
          retryTimer = setTimeout(loadAvailableProviders, PROVIDER_RESTART_POLL_MS)
          return
        }
        console.error("Failed to load available providers:", error)
        setAvailableError(t("settings.providers.page.state.unableToLoadProviderList"))
        setAvailableLoading(false)
      }
    }

    loadAvailableProviders()

    return () => {
      isMounted = false
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [directory, t])

  const connectedProviderIds = React.useMemo(() => new Set(providers.map((provider) => provider.id)), [providers])

  const unconnectedProviders = React.useMemo(
    () =>
      availableProviders
        .filter((provider) => !connectedProviderIds.has(provider.id))
        .sort((a, b) => {
          const labelA = (a.name || a.id).toLowerCase()
          const labelB = (b.name || b.id).toLowerCase()
          return labelA.localeCompare(labelB)
        }),
    [availableProviders, connectedProviderIds],
  )

  React.useEffect(() => {
    if (selectedProviderId !== ADD_PROVIDER_ID) {
      return
    }

    if (candidateProviderId && !unconnectedProviders.some((provider) => provider.id === candidateProviderId)) {
      setCandidateProviderId("")
    }
  }, [selectedProviderId, candidateProviderId, unconnectedProviders])

  React.useEffect(() => {
    if (selectedProviderId === ADD_PROVIDER_ID) {
      setShowAuthPanel(true)
      return
    }

    setShowAuthPanel(false)
  }, [selectedProviderId])

  React.useEffect(() => {
    if (!selectedProviderId || selectedProviderId === ADD_PROVIDER_ID) {
      return
    }

    let cancelled = false

    const loadSources = async () => {
      try {
        const sources = await fetchProviderSources(selectedProviderId, directory)
        if (!cancelled && sources) {
          setProviderSources((prev) => ({
            ...prev,
            [selectedProviderId]: sources,
          }))
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load provider sources:", error)
        }
      }
    }

    loadSources()

    return () => {
      cancelled = true
    }
  }, [directory, selectedProviderId])

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId)
  const selectedSources = selectedProviderId ? providerSources[selectedProviderId] : undefined

  const reloadAfterProviderAuthSave = async (successMessage: string) => {
    // Credentials are global across projects — drop every project-scoped
    // provider snapshot so switching projects does not require reconnect.
    useConfigStore.getState().invalidateAllProviderCaches()
    try {
      await reloadAxCodeConfiguration({
        message: "Restarting AX Code to load provider credentials...",
        scopes: ["providers"],
        mode: "active",
      })
      await loadProviders({ directory })
      toast.success(successMessage)
    } catch (reloadError) {
      console.error("Provider auth was saved, but AX Code reload failed:", reloadError)
      toast.warning(t("settings.providers.page.toast.apiKeySavedRestartFailed"))
      // Still try to refresh the active project from the server.
      await loadProviders({ directory }).catch(() => undefined)
    }
  }

  const handleConnectPrivateGpu = async (providerId: string) => {
    const vendor = dedicatedPrivateGpuVendor(providerId)
    const baseURL = privateGpuEndpointInputs[providerId]?.trim() || vendor?.defaultApi || ""
    const apiKey = apiKeyInputs[providerId]?.trim() ?? ""
    if (!baseURL) {
      toast.error(t("settings.providers.page.toast.privateGpuEndpointRequired"))
      return
    }
    if (!apiKey) {
      toast.error(t("settings.providers.page.toast.apiKeyRequired"))
      return
    }

    const busyKey = `api:${providerId}`
    setAuthBusyKey(busyKey)
    try {
      await connectPrivateGpu({ providerID: providerId, baseURL, apiKey }, directory)
      setApiKeyInputs((prev) => ({ ...prev, [providerId]: "" }))
      await reloadAfterProviderAuthSave(
        t("settings.providers.page.toast.privateGpuConnected", { name: vendor?.name ?? providerId }),
      )
      setSelectedProvider(providerId)
    } catch (error) {
      console.error(`Failed to connect ${vendor?.name ?? providerId}:`, error)
      toast.error(error instanceof Error ? error.message : t("settings.providers.page.toast.apiKeySaveFailed"))
    } finally {
      setAuthBusyKey(null)
    }
  }

  const renderDedicatedPrivateGpuForm = (providerId: string) => {
    const vendor = dedicatedPrivateGpuVendor(providerId)
    if (!vendor) return null
    const endpointValue = privateGpuEndpointInputs[providerId] ?? vendor.defaultApi ?? ""
    return (
      <div className="py-1.5 space-y-2">
        <label className="typography-ui-label text-foreground flex items-center gap-1.5">
          {t("settings.providers.page.auth.privateGpuEndpointLabel")}
          <Tooltip>
            <TooltipTrigger asChild>
              <Icon name="information" className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent sideOffset={8} className="max-w-xs">
              {vendor.hint}
            </TooltipContent>
          </Tooltip>
        </label>
        <Input
          value={endpointValue}
          onChange={(event) =>
            setPrivateGpuEndpointInputs((prev) => ({
              ...prev,
              [providerId]: event.target.value,
            }))
          }
          placeholder={vendor.urlPlaceholder}
          className="font-mono typography-micro"
        />
        <label className="typography-ui-label text-foreground">{t("settings.providers.page.auth.privateGpuTokenLabel")}</label>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <Input
            type="password"
            value={apiKeyInputs[providerId] ?? ""}
            onChange={(event) =>
              setApiKeyInputs((prev) => ({
                ...prev,
                [providerId]: event.target.value,
              }))
            }
            placeholder={vendor.tokenPlaceholder}
            className="flex-1 font-mono typography-micro"
          />
          <Button
            size="xs"
            className="!font-normal shrink-0"
            onClick={() => handleConnectPrivateGpu(providerId)}
            disabled={authBusyKey === `api:${providerId}`}
          >
            {authBusyKey === `api:${providerId}`
              ? t("settings.providers.page.actions.saving")
              : t("settings.providers.page.auth.privateGpuConnect")}
          </Button>
        </div>
      </div>
    )
  }

  const handleSaveApiKey = async (providerId: string) => {
    const apiKey = apiKeyInputs[providerId]?.trim() ?? ""
    if (!apiKey) {
      toast.error(t("settings.providers.page.toast.apiKeyRequired"))
      return
    }

    const busyKey = `api:${providerId}`
    setAuthBusyKey(busyKey)

    try {
      await saveProviderAuth(providerId, apiKey, directory)

      setApiKeyInputs((prev) => ({ ...prev, [providerId]: "" }))
      await reloadAfterProviderAuthSave(t("settings.providers.page.toast.apiKeySaved"))
      setSelectedProvider(providerId)
    } catch (error) {
      console.error("Failed to save API key:", error)
      toast.error(t("settings.providers.page.toast.apiKeySaveFailed"))
    } finally {
      setAuthBusyKey(null)
    }
  }

  const handleUseCliProvider = async (providerId: string) => {
    const busyKey = `cli:${providerId}`
    setAuthBusyKey(busyKey)

    try {
      await saveProviderAuth(providerId, "cli", directory)
      await reloadAfterProviderAuthSave(t("settings.providers.page.toast.cliProviderConnected"))
      setSelectedProvider(providerId)
    } catch (error) {
      console.error("Failed to connect CLI provider:", error)
      toast.error(t("settings.providers.page.toast.cliProviderConnectFailed"))
    } finally {
      setAuthBusyKey(null)
    }
  }

  // Local inference providers (ax-engine, ollama, ax-studio) do not require a
  // cloud API key. Persist the conventional local sentinel so the provider is
  // marked connected; the runtime supplies its own default key when needed.
  const handleEnableLocalProvider = async (providerId: string) => {
    const busyKey = `local:${providerId}`
    setAuthBusyKey(busyKey)

    try {
      await saveProviderAuth(providerId, "local", directory)
      await reloadAfterProviderAuthSave(t("settings.providers.page.toast.localProviderConnected"))
      setSelectedProvider(providerId)
    } catch (error) {
      console.error("Failed to enable local provider:", error)
      toast.error(t("settings.providers.page.toast.localProviderConnectFailed"))
    } finally {
      setAuthBusyKey(null)
    }
  }

  const handleOAuthStart = async (providerId: string, methodIndex: number) => {
    const busyKey = `oauth:${providerId}:${methodIndex}`
    setAuthBusyKey(busyKey)

    try {
      const payload = await fetchProviderJsonWithRetry(
        buildDirectoryUrl(
          replacePathParams(API_ENDPOINTS.provider.oauthAuthorize, {
            providerId,
          }),
          directory,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: methodIndex }),
        },
      )

      const payloadRecord = isRecord(payload) ? payload : {}
      const dataRecord = isRecord(payloadRecord.data) ? payloadRecord.data : payloadRecord
      const urlCandidate =
        (typeof dataRecord.url === "string" && dataRecord.url) ||
        (typeof dataRecord.verification_uri_complete === "string" && dataRecord.verification_uri_complete) ||
        (typeof dataRecord.verification_uri === "string" && dataRecord.verification_uri) ||
        undefined
      const instructions =
        (typeof dataRecord.instructions === "string" && dataRecord.instructions) ||
        (typeof dataRecord.message === "string" && dataRecord.message) ||
        undefined
      const userCode =
        (typeof dataRecord.user_code === "string" && dataRecord.user_code) ||
        (typeof dataRecord.code === "string" && dataRecord.code) ||
        (typeof dataRecord.userCode === "string" && dataRecord.userCode) ||
        undefined

      if (!urlCandidate && !instructions && !userCode) {
        throw new Error(t("settings.providers.page.toast.oauthDetailsMissing"))
      }

      const detailsKey = `${providerId}:${methodIndex}`
      setOauthDetails((prev) => ({
        ...prev,
        [detailsKey]: {
          url: urlCandidate,
          instructions,
          userCode,
        },
      }))

      if (urlCandidate) {
        void openExternalUrl(urlCandidate)
      }
      setPendingOAuth({ providerId, methodIndex })
      toast.message(t("settings.providers.page.toast.completeOAuthInBrowser"))
    } catch (error) {
      console.error("Failed to start OAuth flow:", error)
      toast.error(t("settings.providers.page.toast.oauthStartFailed"))
    } finally {
      setAuthBusyKey(null)
    }
  }

  const handleOAuthComplete = async (providerId: string, methodIndex: number) => {
    const codeKey = `${providerId}:${methodIndex}`
    const code = oauthCodes[codeKey]?.trim()

    const busyKey = `oauth-complete:${providerId}:${methodIndex}`
    setAuthBusyKey(busyKey)

    try {
      const requestBody: { method: number; code?: string } = { method: methodIndex }
      if (code) {
        requestBody.code = code
      }

      await fetchProviderJsonWithRetry(
        buildDirectoryUrl(
          replacePathParams(API_ENDPOINTS.provider.oauthCallback, {
            providerId,
          }),
          directory,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        },
      )

      setOauthCodes((prev) => ({ ...prev, [codeKey]: "" }))
      setPendingOAuth(null)
      try {
        await reloadAxCodeConfiguration({
          message: "Restarting AX Code to load provider credentials...",
          scopes: ["providers"],
          mode: "active",
        })
        toast.success(t("settings.providers.page.toast.oauthCompleted"))
      } catch (reloadError) {
        console.error("OAuth completed, but AX Code reload failed:", reloadError)
        toast.warning(t("settings.providers.page.toast.oauthCompletedRestartFailed"))
      }
      setSelectedProvider(providerId)
    } catch (error) {
      console.error("Failed to complete OAuth flow:", error)
      toast.error(t("settings.providers.page.toast.oauthCompleteFailed"))
    } finally {
      setAuthBusyKey(null)
    }
  }

  const handleCopyOAuthLink = async (url: string) => {
    const result = await copyTextToClipboard(url)
    if (result.ok) {
      toast.success(t("settings.providers.page.toast.oauthLinkCopied"))
      return
    }
    console.error("Failed to copy OAuth link:", result.error)
    toast.error(t("settings.providers.page.toast.oauthLinkCopyFailed"))
  }

  const handleCopyOAuthCode = async (code: string) => {
    const result = await copyTextToClipboard(code)
    if (result.ok) {
      toast.success(t("settings.providers.page.toast.deviceCodeCopied"))
      return
    }
    console.error("Failed to copy device code:", result.error)
    toast.error(t("settings.providers.page.toast.deviceCodeCopyFailed"))
  }

  const handleDisconnectProvider = async (providerId: string) => {
    const busyKey = `disconnect:${providerId}`
    setAuthBusyKey(busyKey)

    try {
      const payload = await disconnectProviderAuth(providerId, directory, "all")

      // Only claim success when something was actually removed. A false
      // "Provider disconnected" toast left the provider listed and made
      // Disconnect look broken (credentials/config still present).
      if (payload?.removed === false) {
        toast.error(t("settings.providers.page.toast.providerDisconnectFailed"))
        return
      }

      toast.success(t("settings.providers.page.toast.providerDisconnected"))
      setShowAuthPanel(false)
      if (payload?.requiresReload) {
        await waitForQueuedAxCodeReload({
          message: payload.message,
          delayMs: payload.reloadDelayMs,
          maxWaitMs: payload.reloadTimeoutMs,
          scopes: ["providers"],
          mode: "active",
        })
      } else {
        // Ensure the sidebar drops the provider even when AX Code did not need
        // a full restart (e.g. config-only disconnect with no daemon reload).
        await loadProviders({ directory })
      }
      if (selectedProviderId === providerId) {
        setSelectedProvider(ADD_PROVIDER_ID)
      }
    } catch (error) {
      console.error("Failed to disconnect provider:", error)
      toast.error(t("settings.providers.page.toast.providerDisconnectFailed"))
    } finally {
      setAuthBusyKey(null)
    }
  }

  const isAddMode = selectedProviderId === ADD_PROVIDER_ID

  if (!isAddMode && providersError && providers.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Icon name="error-warning" className="mx-auto mb-3 h-12 w-12 opacity-60" />
          <p className="typography-markdown">{t("settings.providers.sidebar.error.title")}</p>
          <p className="typography-meta mt-1 opacity-75">{t("settings.providers.sidebar.error.description")}</p>
        </div>
      </div>
    )
  }

  if (!isAddMode && providersLoading && providers.length === 0) {
    return <ViewLoadingSkeleton label={t("settings.providers.sidebar.loading.title")} />
  }

  if (!isAddMode && providers.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Icon name="stack" className="mx-auto mb-3 h-12 w-12 opacity-50" />
          <p className="typography-markdown">{t("settings.providers.page.empty.noProvidersDetected")}</p>
          <p className="typography-meta mt-1 opacity-75">
            {t("settings.providers.page.empty.checkAxCodeConfiguration")}
          </p>
        </div>
      </div>
    )
  }

  if (isAddMode) {
    return (
      <ScrollableOverlay outerClassName="h-full" className="w-full">
        <div className="mx-auto w-full max-w-3xl p-3 sm:p-6 sm:pt-8">
          <div className="mb-4">
            <h1 className="typography-ui-header font-semibold text-foreground">
              {t("settings.providers.page.connect.title")}
            </h1>
          </div>

          <div className="mb-8">
            <div className="mb-1 px-1">
              <h2 className="typography-ui-header font-medium text-foreground">
                {t("settings.providers.page.connect.selectProviderTitle")}
              </h2>
            </div>

            <section className="px-2 pb-2 pt-0">
              <div className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="typography-ui-label text-foreground">
                  {t("settings.providers.page.connect.providerField")}
                </span>
                {availableLoading ? (
                  <p className="typography-meta text-muted-foreground">{t("settings.providers.page.state.loading")}</p>
                ) : availableError ? (
                  <p className="typography-meta text-muted-foreground">{availableError}</p>
                ) : unconnectedProviders.length === 0 ? (
                  <p className="typography-meta text-muted-foreground">
                    {t("settings.providers.page.connect.allProvidersConnected")}
                  </p>
                ) : (
                  <DropdownMenu
                    open={providerDropdownOpen}
                    onOpenChange={(open) => {
                      setProviderDropdownOpen(open)
                      if (!open) setProviderSearchQuery("")
                    }}
                  >
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2 py-2 typography-ui-label whitespace-nowrap shadow-none outline-none hover:bg-interactive-hover h-6 w-fit",
                        )}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          {candidateProviderId ? (
                            <ProviderLogo providerId={candidateProviderId} className="h-3.5 w-3.5 flex-shrink-0" />
                          ) : null}
                          <span
                            className={cn(
                              "truncate typography-ui-label font-normal",
                              candidateProviderId ? "text-foreground" : "text-muted-foreground",
                            )}
                          >
                            {candidateProviderId
                              ? unconnectedProviders.find((p) => p.id === candidateProviderId)?.name ||
                                candidateProviderId
                              : t("settings.providers.page.connect.selectProviderPlaceholder")}
                          </span>
                        </span>
                        <Icon name="arrow-down-s" className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      className="w-[280px] p-0"
                      onCloseAutoFocus={(e) => e.preventDefault()}
                    >
                      <div
                        className="flex items-center gap-2 border-b border-[var(--surface-subtle)] px-3 py-2"
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <Icon name="search" className="h-4 w-4 text-muted-foreground" />
                        <input
                          type="text"
                          value={providerSearchQuery}
                          onChange={(e) => setProviderSearchQuery(e.target.value)}
                          onKeyDown={(e) => e.stopPropagation()}
                          placeholder={t("settings.providers.page.connect.searchProvidersPlaceholder")}
                          className="flex-1 bg-transparent typography-meta outline-none placeholder:text-muted-foreground"
                          autoFocus
                        />
                      </div>
                      <ScrollableOverlay
                        // Cap list height so long catalogs scroll. fillContainer=false so
                        // max-height applies to the scroll target; alwaysShowScrollbar so
                        // the vertical thumb stays visible as a cue that more items exist.
                        outerClassName="max-h-[240px]"
                        className="max-h-[240px] p-1 pr-2"
                        disableHorizontal
                        alwaysShowScrollbar
                        fillContainer={false}
                      >
                        {(() => {
                          const filtered = unconnectedProviders.filter((p) => {
                            const query = providerSearchQuery.toLowerCase()
                            return (p.name || p.id).toLowerCase().includes(query) || p.id.toLowerCase().includes(query)
                          })
                          if (filtered.length === 0) {
                            return (
                              <p className="py-4 text-center typography-meta text-muted-foreground">
                                {t("settings.providers.page.connect.noProvidersFound")}
                              </p>
                            )
                          }
                          return filtered.map((provider) => (
                            <DropdownMenuItem
                              key={provider.id}
                              onSelect={() => {
                                setCandidateProviderId(provider.id)
                                setProviderDropdownOpen(false)
                                setProviderSearchQuery("")
                              }}
                              className="flex items-center justify-between"
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                <ProviderLogo providerId={provider.id} className="h-4 w-4 flex-shrink-0" />
                                <span className="truncate">{provider.name || provider.id}</span>
                              </span>
                              {candidateProviderId === provider.id && (
                                <Icon name="check" className="h-4 w-4 text-[var(--primary-base)]" />
                              )}
                            </DropdownMenuItem>
                          ))
                        })()}
                      </ScrollableOverlay>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </section>
          </div>

          {candidateProviderId && (
            <div className="mb-8">
              <div className="mb-1 px-1">
                <h2 className="typography-ui-header font-medium text-foreground">
                  {t("settings.providers.page.auth.title")}
                </h2>
              </div>

              {authLoading ? (
                <p className="typography-meta text-muted-foreground px-2">
                  {t("settings.providers.page.auth.loadingMethods")}
                </p>
              ) : (
                <section className="px-2 pb-2 pt-0 space-y-4">
                  {isCliProvider(candidateProviderId) ? (
                    <div className="py-1.5">
                      <Button
                        size="xs"
                        className="!font-normal"
                        onClick={() => handleUseCliProvider(candidateProviderId)}
                        disabled={authBusyKey === `cli:${candidateProviderId}`}
                      >
                        {authBusyKey === `cli:${candidateProviderId}`
                          ? t("settings.providers.page.actions.saving")
                          : t("settings.providers.page.actions.useCli")}
                      </Button>
                    </div>
                  ) : isLocalProvider(candidateProviderId) ? (
                    <div className="py-1.5 space-y-2">
                      <p className="typography-meta text-muted-foreground">
                        {t("settings.providers.page.auth.localProviderHint")}
                      </p>
                      <Button
                        size="xs"
                        className="!font-normal"
                        onClick={() => handleEnableLocalProvider(candidateProviderId)}
                        disabled={authBusyKey === `local:${candidateProviderId}`}
                      >
                        {authBusyKey === `local:${candidateProviderId}`
                          ? t("settings.providers.page.actions.saving")
                          : t("settings.providers.page.actions.enableLocal")}
                      </Button>
                    </div>
                  ) : isDedicatedPrivateGpuProvider(candidateProviderId) ? (
                    renderDedicatedPrivateGpuForm(candidateProviderId)
                  ) : (
                    <div className="py-1.5">
                      <label className="typography-ui-label text-foreground flex items-center gap-1.5">
                        {t("settings.providers.page.auth.apiKeyLabel")}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Icon name="information" className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent sideOffset={8} className="max-w-xs">
                            {t("settings.providers.page.auth.apiKeyTooltip")}
                          </TooltipContent>
                        </Tooltip>
                      </label>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mt-1.5">
                        <Input
                          type="password"
                          value={apiKeyInputs[candidateProviderId] ?? ""}
                          onChange={(event) =>
                            setApiKeyInputs((prev) => ({
                              ...prev,
                              [candidateProviderId]: event.target.value,
                            }))
                          }
                          placeholder={t("settings.providers.page.auth.apiKeyPlaceholder")}
                          className="flex-1 font-mono typography-micro"
                        />
                        <Button
                          size="xs"
                          className="!font-normal shrink-0"
                          onClick={() => handleSaveApiKey(candidateProviderId)}
                          disabled={authBusyKey === `api:${candidateProviderId}`}
                        >
                          {authBusyKey === `api:${candidateProviderId}`
                            ? t("settings.providers.page.actions.saving")
                            : t("settings.providers.page.actions.saveKey")}
                        </Button>
                      </div>
                    </div>
                  )}

                  {(() => {
                    const candidateAuthMethods = authMethodsByProvider[candidateProviderId] ?? []
                    const candidateOAuthMethods = candidateAuthMethods.filter(
                      (method) => normalizeAuthType(method) === "oauth",
                    )

                    if (candidateOAuthMethods.length === 0) {
                      return null
                    }

                    return (
                      <div className="space-y-4 border-t border-[var(--surface-subtle)] pt-2">
                        {candidateOAuthMethods.map((method, index) => {
                          const methodLabel =
                            method.label ||
                            method.name ||
                            t("settings.providers.page.auth.oauthMethodFallback", { index: String(index + 1) })
                          const codeKey = `${candidateProviderId}:${index}`
                          const isPending =
                            pendingOAuth?.providerId === candidateProviderId && pendingOAuth?.methodIndex === index

                          return (
                            <div key={`${candidateProviderId}-${methodLabel}`} className="space-y-3">
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <div className="typography-ui-label text-foreground">{methodLabel}</div>
                                  {(method.description || method.help) && (
                                    <div className="typography-meta text-muted-foreground">
                                      {String(method.description || method.help)}
                                    </div>
                                  )}
                                </div>
                                <Button
                                  variant="outline"
                                  size="xs"
                                  className="!font-normal"
                                  onClick={() => handleOAuthStart(candidateProviderId, index)}
                                  disabled={authBusyKey === `oauth:${candidateProviderId}:${index}`}
                                >
                                  {t("settings.providers.page.actions.connect")}
                                </Button>
                              </div>

                              {oauthDetails[codeKey]?.instructions && (
                                <p className="typography-meta text-[var(--primary-base)] bg-[var(--primary-base)]/10 px-2 py-1.5 rounded">
                                  {oauthDetails[codeKey]?.instructions}
                                </p>
                              )}

                              {oauthDetails[codeKey]?.userCode && (
                                <div className="flex items-center gap-2 mt-2">
                                  <Input
                                    value={oauthDetails[codeKey]?.userCode}
                                    readOnly
                                    className="font-mono text-center tracking-widest"
                                  />
                                  <Button
                                    variant="outline"
                                    size="xs"
                                    className="!font-normal"
                                    onClick={() => handleCopyOAuthCode(oauthDetails[codeKey]?.userCode ?? "")}
                                  >
                                    {t("settings.providers.page.actions.copyCode")}
                                  </Button>
                                </div>
                              )}

                              {oauthDetails[codeKey]?.url && (
                                <div className="flex items-center gap-2 mt-2">
                                  <Input
                                    value={oauthDetails[codeKey]?.url}
                                    readOnly
                                    className="typography-micro text-muted-foreground"
                                  />
                                  <div className="flex gap-1 shrink-0">
                                    <Button
                                      variant="outline"
                                      size="xs"
                                      className="!font-normal"
                                      onClick={() => openExternalUrl(oauthDetails[codeKey]?.url ?? "")}
                                    >
                                      {t("settings.providers.page.actions.open")}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="xs"
                                      className="!font-normal"
                                      onClick={() => handleCopyOAuthLink(oauthDetails[codeKey]?.url ?? "")}
                                    >
                                      {t("settings.providers.page.actions.copy")}
                                    </Button>
                                  </div>
                                </div>
                              )}

                              {isPending && (
                                <div className="flex items-center gap-2 mt-2">
                                  <Input
                                    value={oauthCodes[codeKey] ?? ""}
                                    onChange={(event) =>
                                      setOauthCodes((prev) => ({
                                        ...prev,
                                        [codeKey]: event.target.value,
                                      }))
                                    }
                                    placeholder={t("settings.providers.page.auth.pasteAuthorizationCodePlaceholder")}
                                    className="font-mono typography-micro"
                                  />
                                  <Button
                                    size="xs"
                                    className="!font-normal"
                                    onClick={() => handleOAuthComplete(candidateProviderId, index)}
                                    disabled={authBusyKey === `oauth-complete:${candidateProviderId}:${index}`}
                                  >
                                    {authBusyKey === `oauth-complete:${candidateProviderId}:${index}`
                                      ? t("settings.providers.page.actions.saving")
                                      : t("settings.providers.page.actions.complete")}
                                  </Button>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                </section>
              )}
            </div>
          )}
        </div>
      </ScrollableOverlay>
    )
  }

  if (!selectedProvider) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Icon name="stack" className="mx-auto mb-3 h-12 w-12 opacity-50" />
          <p className="typography-markdown">{t("settings.providers.page.empty.selectProviderFromSidebar")}</p>
          <p className="typography-meta mt-1 opacity-75">
            {t("settings.providers.page.empty.reviewDetailsAndConfigureAuth")}
          </p>
        </div>
      </div>
    )
  }

  const providerModels = Array.isArray(selectedProvider.models) ? selectedProvider.models : []
  const providerAuthMethods = authMethodsByProvider[selectedProvider.id] ?? []
  const oauthAuthMethods = providerAuthMethods.filter((method) => normalizeAuthType(method) === "oauth")

  const filteredModels = providerModels.filter((model) => {
    const name = typeof model?.name === "string" ? model.name : ""
    const id = typeof model?.id === "string" ? model.id : ""
    const query = modelQuery.trim().toLowerCase()
    if (!query) return true
    return name.toLowerCase().includes(query) || id.toLowerCase().includes(query)
  })

  return (
    <ScrollableOverlay outerClassName="h-full" className="w-full">
      <div className="mx-auto w-full max-w-3xl p-3 sm:p-6 sm:pt-8">
        {/* Header */}
        <div className="mb-4 flex items-center gap-3">
          <ProviderLogo providerId={selectedProvider.id} className="h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <h2 className="typography-ui-header font-semibold text-foreground truncate">
              {selectedProvider.name || selectedProvider.id}
            </h2>
            <p className="typography-meta text-muted-foreground truncate">
              <span className="font-mono">{selectedProvider.id}</span>
            </p>
          </div>
        </div>

        {/* Authentication */}
        <div className="mb-8">
          <div className="mb-1 px-1 flex items-center justify-between gap-2">
            <h3 className="typography-ui-header font-medium text-foreground">
              {t("settings.providers.page.auth.title")}
            </h3>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="xs"
                className="!font-normal"
                onClick={() => setShowAuthPanel((prev) => !prev)}
              >
                {showAuthPanel
                  ? t("settings.providers.page.actions.hide")
                  : t("settings.providers.page.actions.reconnect")}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className="!font-normal text-[var(--status-error)] hover:text-[var(--status-error)]"
                onClick={() => void handleDisconnectProvider(selectedProvider.id)}
                disabled={authBusyKey === `disconnect:${selectedProvider.id}`}
              >
                {authBusyKey === `disconnect:${selectedProvider.id}`
                  ? t("settings.providers.page.actions.disconnecting")
                  : t("settings.providers.page.actions.disconnect")}
              </Button>
            </div>
          </div>

          <section className="px-2 pb-2 pt-0">
            {!showAuthPanel ? (
              <div className="flex items-center gap-1.5 py-1.5">
                <Icon name="check" className="w-4 h-4 text-[var(--status-success)] shrink-0" />
                <span className="typography-ui-label text-foreground">
                  {t("settings.providers.page.auth.connected")}
                </span>
                <span className="typography-meta text-muted-foreground ml-1">
                  {t("settings.providers.page.auth.useReconnectHint")}
                </span>
              </div>
            ) : authLoading ? (
              <div className="py-1.5 typography-meta text-muted-foreground">
                {t("settings.providers.page.auth.loadingMethods")}
              </div>
            ) : (
              <div className="space-y-4">
                {isCliProvider(selectedProvider.id) ? (
                  <div className="py-1.5">
                    <Button
                      size="xs"
                      className="!font-normal"
                      onClick={() => handleUseCliProvider(selectedProvider.id)}
                      disabled={authBusyKey === `cli:${selectedProvider.id}`}
                    >
                      {authBusyKey === `cli:${selectedProvider.id}`
                        ? t("settings.providers.page.actions.saving")
                        : t("settings.providers.page.actions.useCli")}
                    </Button>
                  </div>
                ) : isLocalProvider(selectedProvider.id) ? (
                  <div className="py-1.5 space-y-2">
                    <p className="typography-meta text-muted-foreground">
                      {t("settings.providers.page.auth.localProviderHint")}
                    </p>
                    <Button
                      size="xs"
                      className="!font-normal"
                      onClick={() => handleEnableLocalProvider(selectedProvider.id)}
                      disabled={authBusyKey === `local:${selectedProvider.id}`}
                    >
                      {authBusyKey === `local:${selectedProvider.id}`
                        ? t("settings.providers.page.actions.saving")
                        : t("settings.providers.page.actions.enableLocal")}
                    </Button>
                  </div>
                ) : isDedicatedPrivateGpuProvider(selectedProvider.id) ? (
                  renderDedicatedPrivateGpuForm(selectedProvider.id)
                ) : (
                  <div className="py-1.5">
                    <label className="typography-ui-label text-foreground flex items-center gap-1.5">
                      {t("settings.providers.page.auth.apiKeyLabel")}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Icon name="information" className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent sideOffset={8} className="max-w-xs">
                          {t("settings.providers.page.auth.apiKeyTooltip")}
                        </TooltipContent>
                      </Tooltip>
                    </label>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 mt-1.5">
                      <Input
                        type="password"
                        value={apiKeyInputs[selectedProvider.id] ?? ""}
                        onChange={(event) =>
                          setApiKeyInputs((prev) => ({
                            ...prev,
                            [selectedProvider.id]: event.target.value,
                          }))
                        }
                        placeholder={t("settings.providers.page.auth.apiKeyPlaceholder")}
                        className="flex-1 font-mono typography-micro"
                      />
                      <Button
                        size="xs"
                        className="!font-normal shrink-0"
                        onClick={() => handleSaveApiKey(selectedProvider.id)}
                        disabled={authBusyKey === `api:${selectedProvider.id}`}
                      >
                        {authBusyKey === `api:${selectedProvider.id}`
                          ? t("settings.providers.page.actions.saving")
                          : t("settings.providers.page.actions.saveKey")}
                      </Button>
                    </div>
                  </div>
                )}

                {oauthAuthMethods.length > 0 && (
                  <div className="space-y-4 border-t border-[var(--surface-subtle)] pt-2">
                    {oauthAuthMethods.map((method, index) => {
                      const methodLabel =
                        method.label ||
                        method.name ||
                        t("settings.providers.page.auth.oauthMethodFallback", { index: String(index + 1) })
                      const codeKey = `${selectedProvider.id}:${index}`
                      const isPending =
                        pendingOAuth?.providerId === selectedProvider.id && pendingOAuth?.methodIndex === index

                      return (
                        <div key={`${selectedProvider.id}-${methodLabel}`} className="space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <div className="typography-ui-label text-foreground">{methodLabel}</div>
                              {(method.description || method.help) && (
                                <div className="typography-meta text-muted-foreground">
                                  {String(method.description || method.help)}
                                </div>
                              )}
                            </div>
                            <Button
                              variant="outline"
                              size="xs"
                              className="!font-normal"
                              onClick={() => handleOAuthStart(selectedProvider.id, index)}
                              disabled={authBusyKey === `oauth:${selectedProvider.id}:${index}`}
                            >
                              {t("settings.providers.page.actions.connect")}
                            </Button>
                          </div>

                          {oauthDetails[codeKey]?.instructions && (
                            <p className="typography-meta text-[var(--primary-base)] bg-[var(--primary-base)]/10 px-2 py-1.5 rounded">
                              {oauthDetails[codeKey]?.instructions}
                            </p>
                          )}

                          {oauthDetails[codeKey]?.userCode && (
                            <div className="flex items-center gap-2 mt-2">
                              <Input
                                value={oauthDetails[codeKey]?.userCode}
                                readOnly
                                className="font-mono text-center tracking-widest"
                              />
                              <Button
                                variant="outline"
                                size="xs"
                                className="!font-normal"
                                onClick={() => handleCopyOAuthCode(oauthDetails[codeKey]?.userCode ?? "")}
                              >
                                {t("settings.providers.page.actions.copyCode")}
                              </Button>
                            </div>
                          )}

                          {oauthDetails[codeKey]?.url && (
                            <div className="flex items-center gap-2 mt-2">
                              <Input
                                value={oauthDetails[codeKey]?.url}
                                readOnly
                                className="typography-micro text-muted-foreground"
                              />
                              <div className="flex gap-1 shrink-0">
                                <Button
                                  variant="outline"
                                  size="xs"
                                  className="!font-normal"
                                  onClick={() => openExternalUrl(oauthDetails[codeKey]?.url ?? "")}
                                >
                                  {t("settings.providers.page.actions.open")}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="xs"
                                  className="!font-normal"
                                  onClick={() => handleCopyOAuthLink(oauthDetails[codeKey]?.url ?? "")}
                                >
                                  {t("settings.providers.page.actions.copy")}
                                </Button>
                              </div>
                            </div>
                          )}

                          {isPending && (
                            <div className="flex items-center gap-2 mt-2">
                              <Input
                                value={oauthCodes[codeKey] ?? ""}
                                onChange={(event) =>
                                  setOauthCodes((prev) => ({
                                    ...prev,
                                    [codeKey]: event.target.value,
                                  }))
                                }
                                placeholder={t("settings.providers.page.auth.pasteAuthorizationCodePlaceholder")}
                                className="font-mono typography-micro"
                              />
                              <Button
                                size="xs"
                                className="!font-normal"
                                onClick={() => handleOAuthComplete(selectedProvider.id, index)}
                                disabled={authBusyKey === `oauth-complete:${selectedProvider.id}:${index}`}
                              >
                                {authBusyKey === `oauth-complete:${selectedProvider.id}:${index}`
                                  ? t("settings.providers.page.actions.saving")
                                  : t("settings.providers.page.actions.complete")}
                              </Button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Connection Details */}
        <div className="mb-8">
          <div className="mb-1 px-1">
            <h3 className="typography-ui-header font-medium text-foreground">
              {t("settings.providers.page.connectionDetails.title")}
            </h3>
          </div>

          <section className="px-2 pb-2 pt-0">
            <div className="flex flex-col gap-2 py-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
              <div className="flex min-w-0 flex-col">
                {selectedSources &&
                (selectedSources.auth.exists ||
                  selectedSources.user.exists ||
                  selectedSources.project.exists ||
                  selectedSources.custom?.exists) ? (
                  <span className="typography-meta text-muted-foreground">
                    {t("settings.providers.page.connectionDetails.configuredIn")}{" "}
                    {[
                      selectedSources.auth.exists
                        ? t("settings.providers.page.connectionDetails.source.authCredentials")
                        : null,
                      selectedSources.user.exists
                        ? t("settings.providers.page.connectionDetails.source.userConfig")
                        : null,
                      selectedSources.project.exists
                        ? t("settings.providers.page.connectionDetails.source.projectConfig")
                        : null,
                      selectedSources.custom?.exists
                        ? t("settings.providers.page.connectionDetails.source.customConfig")
                        : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                ) : (
                  <span className="typography-meta text-muted-foreground">
                    {t("settings.providers.page.connectionDetails.noActiveSource")}
                  </span>
                )}
              </div>

              <Button
                variant="ghost"
                size="xs"
                className="!font-normal text-[var(--status-error)] hover:text-[var(--status-error)]"
                onClick={() => handleDisconnectProvider(selectedProvider.id)}
                disabled={authBusyKey === `disconnect:${selectedProvider.id}`}
              >
                {authBusyKey === `disconnect:${selectedProvider.id}`
                  ? t("settings.providers.page.actions.disconnecting")
                  : t("settings.providers.page.actions.disconnect")}
              </Button>
            </div>
          </section>
        </div>

        {/* Models */}
        <div className="mb-8">
          <div className="mb-1 px-1 flex items-center justify-between gap-2">
            <h3 className="typography-ui-header font-medium text-foreground">
              {t("settings.providers.page.models.title")}
              {providerModels.length > 0 && (
                <span className="ml-1.5 typography-micro text-muted-foreground font-normal">
                  ({providerModels.length})
                </span>
              )}
            </h3>
            <div className="flex items-center gap-1">
              {selectedProvider.id === AX_ENGINE_PROVIDER_ID && (
                <Button
                  variant="outline"
                  size="xs"
                  className="!font-normal"
                  onClick={() => void loadAxEngineCatalog()}
                  disabled={axEngineBusyKey !== null}
                >
                  <Icon name="refresh" className="h-3.5 w-3.5" />
                  {t("settings.providers.page.actions.refreshLocal")}
                </Button>
              )}
              <Button
                variant="outline"
                size="xs"
                className="!font-normal"
                onClick={() => {
                  const allIds = providerModels
                    .map((model) => (typeof model?.id === "string" ? model.id : ""))
                    .filter((id) => id.length > 0)
                  hideAllModels(selectedProvider.id, allIds)
                }}
              >
                {t("settings.providers.page.actions.hideAll")}
              </Button>
              <Button
                variant="outline"
                size="xs"
                className="!font-normal"
                onClick={() => showAllModels(selectedProvider.id)}
              >
                {t("settings.providers.page.actions.showAll")}
              </Button>
            </div>
          </div>

          <section className="px-2 pb-2 pt-0">
            {selectedProvider.id === AX_ENGINE_PROVIDER_ID && (
              <p className="typography-meta text-muted-foreground mb-2">
                {t("settings.providers.page.models.axEngineDownloadHint")}
              </p>
            )}
            <div className="relative mb-2">
              <Icon
                name="search"
                className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
              />
              <Input
                value={modelQuery}
                onChange={(event) => setModelQuery(event.target.value)}
                placeholder={t("settings.providers.page.models.filterPlaceholder")}
                className="h-7 pl-8 w-full"
              />
            </div>

            {filteredModels.length === 0 ? (
              <p className="typography-meta text-muted-foreground py-4 text-center">
                {t("settings.providers.page.models.noModelsMatchFilter")}
              </p>
            ) : (
              <div className="divide-y divide-[var(--surface-subtle)]">
                {filteredModels.map((model) => {
                  const modelId = typeof model?.id === "string" ? model.id : ""
                  const modelName = typeof model?.name === "string" ? model.name : modelId
                  const metadata = modelId
                    ? (getModelMetadata(selectedProvider.id, modelId) as ModelMetadata | undefined)
                    : undefined
                  const isHidden = hiddenModels.some(
                    (item) => item.providerID === selectedProvider.id && item.modelID === modelId,
                  )
                  const localEntry = selectedProvider.id === AX_ENGINE_PROVIDER_ID ? axEngineEntryById.get(modelId) : undefined
                  const activeJob = modelId ? axEngineActiveJob(modelId) : undefined
                  const downloadBusy =
                    Boolean(modelId) &&
                    (axEngineBusyKey === modelId || (activeJob ? axEngineBusyKey === activeJob.id : false))

                  const contextTokens = formatTokens(metadata?.limit?.context)
                  const outputTokens = formatTokens(metadata?.limit?.output)

                  const capabilityIcons: Array<{ key: string; icon: IconName; label: string }> = []
                  if (metadata?.tool_call)
                    capabilityIcons.push({
                      key: "tools",
                      icon: "tools",
                      label: t("settings.providers.page.models.capability.toolCalling"),
                    })
                  if (metadata?.reasoning)
                    capabilityIcons.push({
                      key: "reasoning",
                      icon: "brain-ai-3",
                      label: t("settings.providers.page.models.capability.reasoning"),
                    })
                  if (metadata?.attachment)
                    capabilityIcons.push({
                      key: "image",
                      icon: "file-image",
                      label: t("settings.providers.page.models.capability.imageInput"),
                    })

                  const downloadPercent =
                    activeJob?.progress?.mode === "determinate" && Number.isFinite(activeJob.progress.percent)
                      ? Math.max(0, Math.min(100, Math.round(activeJob.progress.percent)))
                      : undefined
                  const localStatusLabel = !localEntry
                    ? null
                    : activeJob
                      ? downloadPercent !== undefined
                        ? `${t("settings.providers.page.models.localStatus.downloading")} ${downloadPercent}%`
                        : t("settings.providers.page.models.localStatus.downloading")
                      : localEntry.local.present && localEntry.local.complete
                        ? t("settings.providers.page.models.localStatus.downloaded")
                        : localEntry.fit.downloadable
                          ? t("settings.providers.page.models.localStatus.readyToDownload")
                          : t("settings.providers.page.models.localStatus.unavailable")

                  return (
                    <div key={modelId} className="py-1.5">
                      <div className={cn("flex items-center gap-3", isHidden && "opacity-50")}>
                        <div className="flex-1 min-w-0">
                          <div className="typography-meta font-medium text-foreground truncate">{modelName}</div>
                          {localStatusLabel && (
                            <div className="typography-micro text-muted-foreground mt-0.5">{localStatusLabel}</div>
                          )}
                          {activeJob && (
                            <div
                              className="relative mt-1.5 h-1 w-full max-w-[12rem] overflow-hidden rounded-full bg-border"
                              role="progressbar"
                              aria-label={`${modelName} downloading`}
                              aria-valuemin={downloadPercent !== undefined ? 0 : undefined}
                              aria-valuemax={downloadPercent !== undefined ? 100 : undefined}
                              aria-valuenow={downloadPercent}
                            >
                              {downloadPercent !== undefined ? (
                                <div
                                  className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-500 ease-out"
                                  style={{ width: `${downloadPercent}%` }}
                                />
                              ) : (
                                <div className="oc-indeterminate-progress-bar absolute inset-y-0 left-0 w-1/4 rounded-full bg-primary" />
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {(contextTokens || outputTokens) && (
                            <span className="typography-micro text-muted-foreground flex-shrink-0 bg-[var(--surface-muted)] px-1.5 py-0.5 rounded">
                              {contextTokens
                                ? `${contextTokens} ${t("settings.providers.page.models.tokenBadge.context")}`
                                : ""}
                              {contextTokens && outputTokens ? " · " : ""}
                              {outputTokens
                                ? `${outputTokens} ${t("settings.providers.page.models.tokenBadge.output")}`
                                : ""}
                            </span>
                          )}
                          {capabilityIcons.length > 0 && (
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {capabilityIcons.map(({ key, icon: iconName, label }) => (
                                <span
                                  key={key}
                                  className="flex h-5 w-5 rounded items-center justify-center text-muted-foreground bg-[var(--surface-muted)]"
                                  title={label}
                                  aria-label={label}
                                >
                                  <Icon name={iconName} className="h-3 w-3" />
                                </span>
                              ))}
                            </div>
                          )}
                          {selectedProvider.id === AX_ENGINE_PROVIDER_ID && localEntry && (
                            <>
                              {activeJob ? (
                                <Button
                                  size="xs"
                                  variant="outline"
                                  className="!font-normal shrink-0"
                                  disabled={downloadBusy}
                                  onClick={() => void handleAxEngineCancel(activeJob)}
                                >
                                  <Icon
                                    name={downloadBusy ? "loader" : "close"}
                                    className={cn("h-3.5 w-3.5", downloadBusy && "animate-spin")}
                                  />
                                  {t("settings.providers.page.models.actions.cancelDownload")}
                                </Button>
                              ) : localEntry.local.present && localEntry.local.complete ? (
                                <span className="typography-micro text-[var(--status-success)] shrink-0">
                                  {t("settings.providers.page.models.localStatus.readyForChat")}
                                </span>
                              ) : (
                                <Button
                                  size="xs"
                                  className="!font-normal shrink-0"
                                  disabled={downloadBusy || !localEntry.fit.downloadable}
                                  title={
                                    !localEntry.fit.downloadable
                                      ? (localEntry.fit.blockers[0] ??
                                        t("settings.providers.page.models.localStatus.unavailable"))
                                      : undefined
                                  }
                                  onClick={() => void handleAxEngineDownload(modelId, modelName)}
                                >
                                  <Icon
                                    name={downloadBusy ? "loader" : "download"}
                                    className={cn("h-3.5 w-3.5", downloadBusy && "animate-spin")}
                                  />
                                  {t("settings.providers.page.models.actions.download")}
                                </Button>
                              )}
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => toggleHiddenModel(selectedProvider.id, modelId)}
                            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-[var(--interactive-hover)]/50"
                            title={
                              isHidden
                                ? t("settings.providers.page.models.actions.showModelInSelectors")
                                : t("settings.providers.page.models.actions.hideModelFromSelectors")
                            }
                            aria-label={
                              isHidden
                                ? t("settings.providers.page.models.actions.showModel")
                                : t("settings.providers.page.models.actions.hideModel")
                            }
                          >
                            {isHidden ? (
                              <Icon name="eye-off" className="h-3.5 w-3.5" />
                            ) : (
                              <Icon name="eye" className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </ScrollableOverlay>
  )
}
