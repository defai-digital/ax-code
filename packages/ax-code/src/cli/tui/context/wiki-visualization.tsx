import type { WikiMaintenanceStatus } from "@/wiki/idle-controller"
import type { WikiGraph } from "@ax-code/ax-wiki/graph"
import { createSignal, onCleanup } from "solid-js"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"
import { useLanguage } from "./language"
import { useToast } from "../ui/toast"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { Clipboard } from "../util/clipboard"
import {
  createWikiVisualizationManager,
  fetchWikiVisualization,
  requestWikiMaintenance,
  wikiPollDelay,
  WikiVizError,
  type WikiViewerListener,
} from "../util/wiki-visualization"

export const { use: useWikiVisualization, provider: WikiVisualizationProvider } = createSimpleContext({
  name: "WikiVisualization",
  init: (props: { manager: ReturnType<typeof createWikiVisualizationManager> }) => {
    const sdk = useSDK()
    const t = useLanguage().t
    const toast = useToast()
    const dialog = useDialog()
    const [opening, setOpening] = createSignal(false)
    const [maintenance, setMaintenance] = createSignal<WikiMaintenanceStatus>()
    const lifetime = new AbortController()
    let currentAgent = "build"
    let currentActive = false
    let currentSessionID: string | undefined
    let registration: AbortController | undefined
    const refreshFailures = new WeakSet<WikiViewerListener>()
    onCleanup(() => {
      lifetime.abort()
      registration?.abort()
    })
    async function enable(agent: string, active = false, sessionID?: string) {
      currentAgent = agent
      currentActive = active
      currentSessionID = sessionID
      registration?.abort()
      registration = new AbortController()
      const signal = AbortSignal.any([lifetime.signal, registration.signal])
      const client = sdk.client
      const base = sdk.url
      const directory = sdk.directory
      const transport = sdk.fetch
      const isCurrent = () =>
        !signal.aborted &&
        sdk.client === client &&
        sdk.directory === directory &&
        sdk.url === base &&
        sdk.fetch === transport
      void (async () => {
        let registered = false
        let failures = 0
        while (isCurrent()) {
          try {
            const status = await requestWikiMaintenance({
              base,
              directory,
              fetch: transport,
              signal,
              agent,
              active,
              sessionID,
              action: registered ? undefined : "enable",
            })
            if (!isCurrent()) return
            registered = true
            failures = 0
            setMaintenance(status)
          } catch (error) {
            if (!isCurrent()) return
            setMaintenance({ phase: "failed", reason: "failed", completed: 0, total: 0, revision: 0 })
            if (
              WikiVizError.isInstance(error) &&
              (error.data.reason === "unauthorized" || error.data.reason === "unsupported")
            )
              return
            registered = false
            failures++
          }
          try {
            await wikiPollDelay(signal, Math.min(1500 * 2 ** Math.min(failures, 5), 60_000))
          } catch {
            return
          }
        }
      })()
    }
    onCleanup(props.manager.subscribe(setOpening))
    async function open(directory?: () => string | undefined) {
      const base = sdk.url
      const transport = sdk.fetch
      const client = sdk.client
      const scopeDirectory = sdk.directory
      const capturedDirectory = scopeDirectory ?? directory?.()
      try {
        const isCurrent = () =>
          !lifetime.signal.aborted &&
          sdk.url === base &&
          sdk.fetch === transport &&
          sdk.client === client &&
          sdk.directory === scopeDirectory &&
          (scopeDirectory !== undefined || directory?.() === capturedDirectory)
        const result = await props.manager.activate({
          scope: JSON.stringify([base, capturedDirectory]),
          // Bind the local loading page before any runtime/model request.
          load: async (): Promise<WikiGraph> => ({
            schemaVersion: 1,
            snapshot: "live",
            scope: "wiki-manifest",
            codeRelationships: "unavailable",
            nodes: [],
            edges: [],
            omitted: { nodes: 0, edges: 0 },
          }),
          isCurrent,
          refresh: async (listener, signal) => {
            try {
              const status = await requestWikiMaintenance({
                base,
                directory: capturedDirectory,
                fetch: transport,
                signal,
                action: "refresh",
                agent: currentAgent,
                active: currentActive,
                sessionID: currentSessionID,
              })
              if (signal.aborted || !isCurrent()) return
              refreshFailures.delete(listener)
              listener.update?.(status)
              setMaintenance(status)
            } catch {
              if (signal.aborted || !isCurrent()) return
              refreshFailures.add(listener)
              const failed: WikiMaintenanceStatus = {
                phase: "failed",
                reason: "failed",
                completed: 0,
                total: 0,
                revision: 0,
              }
              listener.update?.(failed)
              setMaintenance(failed)
            }
          },
          monitor: async (listener, signal) => {
            let revision = -1
            let attemptedSnapshot = false
            while (!signal.aborted && isCurrent()) {
              try {
                const status = await requestWikiMaintenance({
                  base,
                  directory: capturedDirectory,
                  fetch: transport,
                  signal,
                })
                if (signal.aborted || !isCurrent()) return
                let graph: WikiGraph | undefined
                if (!attemptedSnapshot || status.revision !== revision) {
                  try {
                    graph = await fetchWikiVisualization({
                      base,
                      directory: capturedDirectory,
                      fetch: transport,
                      signal,
                    })
                  } catch (error) {
                    if (!WikiVizError.isInstance(error) || error.data.reason !== "missing") throw error
                  }
                  attemptedSnapshot = true
                  revision = status.revision
                }
                if (signal.aborted || !isCurrent()) return
                if (status.phase === "ready" || status.phase === "running") refreshFailures.delete(listener)
                const visible = refreshFailures.has(listener)
                  ? { ...status, phase: "failed" as const, reason: "failed" as const }
                  : status
                listener.update?.(visible, graph)
                if (sdk.directory === capturedDirectory) setMaintenance(visible)
              } catch {
                if (signal.aborted || !isCurrent()) return
                const failed: WikiMaintenanceStatus = {
                  phase: "failed",
                  reason: "failed",
                  completed: 0,
                  total: 0,
                  revision: 0,
                }
                listener.update?.(failed)
                setMaintenance(failed)
              }
              try {
                await wikiPollDelay(signal)
              } catch {
                return
              }
            }
          },
        })
        if (result.opened) return
        dialog.replace(() => (
          <DialogSelect
            title={t("ui.wikiBrowserFallback")}
            skipFilter
            options={[
              {
                title: t("ui.copy"),
                value: "copy",
                footer: result.url,
                onSelect: () => {
                  void Clipboard.copy(result.url)
                    .then(() => {
                      dialog.clear()
                      toast.show({ message: t("ui.copiedToClipboard"), variant: "success" })
                    })
                    .catch(() => toast.show({ message: t("ui.failedToCopyToClipboard"), variant: "error" }))
                },
              },
              {
                title: t("ui.open"),
                value: "retry",
                onSelect: () => {
                  dialog.clear()
                  void open(directory)
                },
              },
            ]}
          />
        ))
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return
        const reason = WikiVizError.isInstance(error) ? error.data.reason : "failed"
        const key =
          reason === "missing"
            ? "ui.wikiSnapshotMissing"
            : reason === "unsupported"
              ? "ui.wikiUnsupportedRuntime"
              : "ui.wikiRequestFailed"
        toast.show({ message: t(key), variant: "error", duration: 7000 })
      }
    }
    return { open, opening, enable, maintenance }
  },
})
