import { useSessionUIStore } from "@/sync/session-ui-store"
import { useDirectoryStore } from "@/stores/useDirectoryStore"
import { useProjectsStore } from "@/stores/useProjectsStore"
import { axCodeClient } from "@/lib/ax-code/client"
import { checkIsGitRepository } from "@/lib/gitApi"
import { streamDebugEnabled } from "@/stores/utils/streamDebug"
import { copyTextToClipboard as copyPlainTextToClipboard } from "@/lib/clipboard"
import { getSyncSessions, getSyncMessages, getSyncParts } from "@/sync/sync-refs"
import { useStreamingStore } from "@/sync/streaming"
import { API_ENDPOINTS, HTTP_DEFAULTS } from "@/lib/http"
import { isRecord } from "@/lib/record"

type SyncPart = ReturnType<typeof getSyncParts>[number]

type DebugPartInfo = {
  id: string
  type: string
  text?: string
  textLength?: number
  tool?: unknown
  state?: unknown
  isStepMarker?: boolean
}

type DebugGlobals = {
  __AX_CODE_DESKTOP_RUNTIME_APIS__?: {
    runtime?: {
      platform?: unknown
    }
  }
  __TAURI__?: unknown
  __axCodeDebug?: unknown
}

const getField = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined)

const getStringField = (value: unknown, key: string): string | undefined => {
  const field = getField(value, key)
  return typeof field === "string" ? field : undefined
}

const getNumberField = (value: unknown, key: string): number | undefined => {
  const field = getField(value, key)
  return typeof field === "number" ? field : undefined
}

const getRecordField = (value: unknown, key: string): Record<string, unknown> | undefined => {
  const field = getField(value, key)
  return isRecord(field) ? field : undefined
}

const getPartType = (part: SyncPart): string => String(part.type)

const summarizePart = (part: SyncPart): DebugPartInfo => {
  const type = getPartType(part)
  const info: DebugPartInfo = {
    id: part.id,
    type,
  }

  if (type === "text") {
    const text = getStringField(part, "text")
    info.text = text
    info.textLength = text?.length || 0
  } else if (type === "tool") {
    info.tool = getField(part, "tool")
    info.state = getField(getRecordField(part, "state"), "status")
  } else if (type === "step-start" || type === "step-finish") {
    info.isStepMarker = true
  }

  return info
}

const hasTextContent = (part: DebugPartInfo): boolean =>
  part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0

const isToolPart = (part: { type: string }): boolean => part.type === "tool"
const isStepMarkerPart = (part: { type: string }): boolean => part.type === "step-start" || part.type === "step-finish"

export interface DebugMessageInfo {
  messageId: string
  role: string
  timestamp: number
  partsCount: number
  parts: DebugPartInfo[]
  isEmpty: boolean
  isEmptyResponse: boolean
  raw: unknown
}

export const debugUtils = {
  getLastAssistantMessage(): DebugMessageInfo | null {
    const state = useSessionUIStore.getState()
    const currentSessionId = state.currentSessionId

    if (!currentSessionId) {
      console.log("[ERROR] No active session")
      return null
    }

    const messages = getSyncMessages(currentSessionId)
    if (!messages || messages.length === 0) {
      console.log("[ERROR] No messages in current session")
      return null
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === "assistant") {
        const msgParts = getSyncParts(msg.id) || []
        const parts = msgParts.map(summarizePart)

        const hasText = parts.some(hasTextContent)
        const hasTools = parts.some(isToolPart)
        const hasStepMarkers = parts.some(isStepMarkerPart)
        const isEmpty = parts.length === 0
        const isEmptyResponse = !hasText && !hasTools && (!isEmpty || hasStepMarkers)

        const info: DebugMessageInfo = {
          messageId: msg.id,
          role: msg.role,
          timestamp: getNumberField(getRecordField(msg, "time"), "created") || 0,
          partsCount: parts.length,
          parts,
          isEmpty,
          isEmptyResponse,
          raw: msg,
        }

        console.log("[INSPECT] Last Assistant Message:", info)
        console.log("[SUMMARY] Summary:", {
          messageId: info.messageId,
          partsCount: info.partsCount,
          isEmpty: info.isEmpty,
          isEmptyResponse: info.isEmptyResponse,
          hasText,
          hasTools,
          hasStepMarkers,
          onlyStepMarkers: hasStepMarkers && !hasText && !hasTools,
        })

        if (info.isEmpty) {
          console.warn("[WARNING] Message has NO parts!")
        }

        if (info.isEmptyResponse) {
          console.warn("[WARNING] Message has parts but NO meaningful content (empty text, no tools)!")

          if (hasStepMarkers && !hasText && !hasTools) {
            console.warn(
              "[CRITICAL] CLAUDE EMPTY RESPONSE BUG: Only step-start/step-finish markers, no actual content!",
            )
            console.log("This is a known issue with Claude models (anthropic provider)")
            console.log("Recommendation: Send a follow-up message or try a different model")
          }
        }

        return info
      }
    }

    console.log("[ERROR] No assistant messages found in current session")
    return null
  },

  truncateString(value: string | undefined, maxLength: number = 80): string | undefined {
    if (!value || typeof value !== "string") return value
    if (value.length <= maxLength) return value
    return value.substring(0, maxLength) + "…"
  },

  truncateMessages(messages: unknown[]): Array<Record<string, unknown> & { parts: Record<string, unknown>[] }> {
    return messages.map((msg) => ({
      ...(isRecord(msg) ? msg : {}),
      parts: (getSyncParts(getStringField(msg, "id") ?? "") || []).map((part) => {
        const truncatedPart: Record<string, unknown> = { ...part }

        if ("text" in part) {
          truncatedPart.text = this.truncateString(getStringField(part, "text"))
        }
        if ("textPreview" in part) {
          truncatedPart.textPreview = this.truncateString(getStringField(part, "textPreview"))
        }

        const state = getRecordField(part, "state")
        if (state) {
          const truncatedState: Record<string, unknown> = { ...state }

          if ("output" in state) {
            truncatedState.output = this.truncateString(getStringField(state, "output"))
          }
          if ("error" in state) {
            truncatedState.error = this.truncateString(getStringField(state, "error"))
          }
          const metadata = getRecordField(state, "metadata")
          if (metadata && "preview" in metadata) {
            truncatedState.metadata = {
              ...metadata,
              preview: this.truncateString(getStringField(metadata, "preview")),
            }
          }
          truncatedPart.state = truncatedState
        }

        return truncatedPart
      }),
    }))
  },

  getAllMessages(truncate: boolean = false) {
    const state = useSessionUIStore.getState()
    const currentSessionId = state.currentSessionId

    if (!currentSessionId) {
      console.log("[ERROR] No active session")
      return []
    }

    const messages = getSyncMessages(currentSessionId)
    console.log(`[MESSAGES] Total messages in session: ${messages.length}`)

    messages.forEach((msg, idx) => {
      const msgParts = getSyncParts(msg.id) || []
      console.log(`[${idx}] ${msg.role} - ${msg.id} - ${msgParts.length} parts`)
    })

    return truncate ? this.truncateMessages(messages) : messages
  },

  async getAppStatus() {
    const directoryState = useDirectoryStore.getState()
    const sessionState = useSessionUIStore.getState()
    const projectsState = useProjectsStore.getState()
    const currentDirectory = directoryState.currentDirectory || null
    const axCodeDirectory = axCodeClient.getDirectory() ?? null

    const sessions = getSyncSessions()
    const sessionDirectories = new Set<string>()
    const sessionDirectoryCounts: Record<string, number> = {}

    sessions.forEach((session) => {
      const directory = (session as { directory?: string | null }).directory
      if (typeof directory === "string" && directory.trim().length > 0) {
        sessionDirectories.add(directory)
        sessionDirectoryCounts[directory] = (sessionDirectoryCounts[directory] ?? 0) + 1
      } else {
        sessionDirectoryCounts["(none)"] = (sessionDirectoryCounts["(none)"] ?? 0) + 1
      }
    })

    const localStorageSnapshot = (() => {
      if (typeof window === "undefined") {
        return { available: false }
      }
      try {
        return {
          available: true,
          lastDirectory: window.localStorage.getItem("lastDirectory"),
          homeDirectory: window.localStorage.getItem("homeDirectory"),
        }
      } catch (error) {
        return {
          available: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })()

    const runtimeApis =
      typeof window !== "undefined" ? (window as unknown as DebugGlobals).__AX_CODE_DESKTOP_RUNTIME_APIS__ : null
    const isTauriShell = typeof window !== "undefined" && Boolean((window as unknown as DebugGlobals).__TAURI__)

    const safeJson = async (resp: Response) => {
      try {
        return await resp.json()
      } catch {
        return null
      }
    }

    const safeText = async (resp: Response) => {
      try {
        return await resp.text()
      } catch {
        return null
      }
    }

    const safeFetchJson = async (url: string): Promise<unknown> => {
      try {
        const resp = await fetch(url)
        return resp.ok ? await safeJson(resp) : { status: resp.status }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    }

    let pathInfo: unknown = null
    let projectInfo: unknown = null
    let settingsInfo: unknown = null
    let axCodeHealth: unknown = null

    const pathUrl = currentDirectory
      ? `${API_ENDPOINTS.debug.path}?directory=${encodeURIComponent(currentDirectory)}`
      : API_ENDPOINTS.debug.path
    pathInfo = await safeFetchJson(pathUrl)

    const projectUrl = currentDirectory
      ? `${API_ENDPOINTS.debug.projectCurrent}?directory=${encodeURIComponent(currentDirectory)}`
      : API_ENDPOINTS.debug.projectCurrent
    projectInfo = await safeFetchJson(projectUrl)

    settingsInfo = await safeFetchJson(API_ENDPOINTS.config.settings)

    try {
      const resp = await fetch(API_ENDPOINTS.debug.health, {
        method: HTTP_DEFAULTS.method.get,
        headers: HTTP_DEFAULTS.headers.acceptJson,
      })
      const contentType = resp.headers.get("content-type") || ""
      const body = await safeText(resp)
      const isJson = contentType.toLowerCase().includes("application/json")
      let parsed: Record<string, unknown> | null = null
      if (isJson && body) {
        try {
          const candidate = JSON.parse(body) as unknown
          if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
            parsed = candidate as Record<string, unknown>
          }
        } catch {
          parsed = null
        }
      }
      axCodeHealth = {
        status: resp.status,
        ok: resp.ok,
        contentType,
        type: isJson ? "json" : "html",
        axCodePort: parsed?.axCodePort ?? null,
        axCodeRunning: parsed?.axCodeRunning ?? null,
        axCodeSecureConnection: parsed?.axCodeSecureConnection ?? null,
        axCodeAuthSource: parsed?.axCodeAuthSource ?? null,
        isAxCodeReady: parsed?.isAxCodeReady ?? null,
        lastAxCodeError: parsed?.lastAxCodeError ?? null,
        preview: body ? body.slice(0, 120) : null,
      }
    } catch (error) {
      axCodeHealth = { error: error instanceof Error ? error.message : String(error) }
    }

    let gitCheck: { isGitRepo: boolean | null; error?: string } = { isGitRepo: null }
    if (currentDirectory) {
      try {
        gitCheck.isGitRepo = await checkIsGitRepository(currentDirectory)
      } catch (error) {
        gitCheck = {
          isGitRepo: null,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }

    const projectSamples = projectsState.projects.map((project) => ({
      id: project.id,
      path: project.path,
      label: project.label,
    }))

    const report = {
      runtime: {
        platform: runtimeApis?.runtime?.platform ?? null,
        isDesktop: isTauriShell,
        hasRuntimeApis: Boolean(runtimeApis),
        desktopServerOrigin: null,
      },
      location:
        typeof window !== "undefined"
          ? {
              href: window.location?.href ?? null,
              origin: window.location?.origin ?? null,
            }
          : null,
      directories: {
        currentDirectory,
        axCodeDirectory:
          (pathInfo as { directory?: string; worktree?: string } | null)?.directory ||
          (pathInfo as { worktree?: string } | null)?.worktree ||
          axCodeDirectory,
        homeDirectory: directoryState.homeDirectory || null,
        isHomeReady: directoryState.isHomeReady,
        hasPersistedDirectory: directoryState.hasPersistedDirectory,
        isSwitchingDirectory: directoryState.isSwitchingDirectory,
      },
      projects: {
        total: projectsState.projects.length,
        activeProjectId: projectsState.activeProjectId,
        samples: projectSamples,
      },
      sessions: {
        total: sessions.length,
        currentSessionId: sessionState.currentSessionId,
        lastLoadedDirectory: sessionState.lastLoadedDirectory,
        uniqueDirectories: sessionDirectories.size,
        directorySamples: Array.from(sessionDirectories).slice(0, 5),
        directoryCounts: sessionDirectoryCounts,
      },
      worktrees: {
        available: sessionState.availableWorktrees.length,
        metadataEntries: sessionState.worktreeMetadata.size,
      },
      git: gitCheck,
      localStorage: localStorageSnapshot,
      axCode: {
        pathInfo,
        projectInfo,
        health: axCodeHealth,
      },
      openchamber: {
        settingsInfo,
      },
    }

    console.log("[DEBUG] App status snapshot:", report)
    return report
  },

  async buildDiagnosticsReport() {
    const report = await this.getAppStatus()
    return JSON.stringify(report, null, 2)
  },

  async copyTextToClipboard(text: string) {
    return copyPlainTextToClipboard(text)
  },

  async copyDiagnosticsReport() {
    const report = await this.buildDiagnosticsReport()
    const result = await this.copyTextToClipboard(report)
    return { ...result, report } as const
  },

  checkLastMessage() {
    const info = this.getLastAssistantMessage()
    if (!info) return false

    const isProblematic = info.isEmpty || info.isEmptyResponse

    if (isProblematic) {
      console.error("[ALERT] PROBLEMATIC MESSAGE DETECTED!")
      console.log("Details:", {
        messageId: info.messageId,
        isEmpty: info.isEmpty,
        isEmptyResponse: info.isEmptyResponse,
        partsCount: info.partsCount,
      })

      if (info.parts.length > 0) {
        console.log("Parts:", info.parts)
      }
    } else {
      console.log("[OK] Last message looks good!")
    }

    return isProblematic
  },

  getStreamingState() {
    const sessionState = useSessionUIStore.getState()
    const streamingState = useStreamingStore.getState()
    const currentStreamingId = sessionState.currentSessionId
      ? (streamingState.streamingMessageIds.get(sessionState.currentSessionId) ?? null)
      : null
    console.log("[STREAM] Streaming State:", {
      streamingMessageId: currentStreamingId,
      streamingMessageIds: Array.from(streamingState.streamingMessageIds.entries()),
      messageStreamStates: Array.from(streamingState.messageStreamStates.entries()),
    })
    return {
      streamingMessageId: currentStreamingId,
      streamingMessageIds: streamingState.streamingMessageIds,
      streamStates: streamingState.messageStreamStates,
    }
  },

  findEmptyMessages() {
    const state = useSessionUIStore.getState()
    const currentSessionId = state.currentSessionId

    if (!currentSessionId) {
      console.log("[ERROR] No active session")
      return []
    }

    const messages = getSyncMessages(currentSessionId)
    const emptyMessages = messages
      .filter((msg) => msg.role === "assistant")
      .filter((msg) => {
        const parts = getSyncParts(msg.id) || []
        const hasTextContent = parts.some(
          (part) => getPartType(part) === "text" && (getStringField(part, "text")?.trim().length ?? 0) > 0,
        )
        const hasTools = parts.some((part) => getPartType(part) === "tool")

        return parts.length === 0 || (!hasTextContent && !hasTools)
      })

    console.log(`[INSPECT] Found ${emptyMessages.length} empty assistant messages`)

    emptyMessages.forEach((msg, idx) => {
      const parts = getSyncParts(msg.id) || []
      console.log(`[${idx}] Empty message:`, {
        messageId: msg.id,
        partsCount: parts.length,
        provider: getField(msg, "providerID"),
        model: getField(msg, "modelID"),
        timestamp: getNumberField(getRecordField(msg, "time"), "created"),
      })
    })

    return emptyMessages
  },

  showRetryHelp() {
    console.log("[DEBUG] How to handle empty Claude responses:\n")
    console.log("1. Check the last message:")
    console.log("   __axCodeDebug.getLastAssistantMessage()\n")
    console.log("2. Find all empty messages in session:")
    console.log("   __axCodeDebug.findEmptyMessages()\n")
    console.log("3. To retry, you can:")
    console.log("   - Edit your last user message and resend")
    console.log('   - Send a follow-up message like "Please provide the response"')
    console.log("   - Try a different model (OpenAI models tend to be more reliable)\n")
    console.log("[TIP] Empty responses are usually due to:")
    console.log("   - Model rate limits")
    console.log("   - Context length issues")
    console.log("   - Model refusing to respond to certain prompts")
    console.log("   - API errors from provider")
  },

  analyzeMessageCompletionConsistency(
    options: {
      includeNonAssistant?: boolean
      verbose?: boolean
      maxTableRows?: number
    } = {},
  ) {
    const { includeNonAssistant = false, verbose = true, maxTableRows = 25 } = options
    const state = useSessionUIStore.getState()
    const currentSessionId = state.currentSessionId

    if (!currentSessionId) {
      console.log("[ERROR] No active session")
      return { summary: null, rows: [] }
    }

    const messages = getSyncMessages(currentSessionId)
    const targetMessages = includeNonAssistant ? messages : messages.filter((msg) => msg.role === "assistant")

    const summary = {
      totalMessages: messages.length,
      analyzedMessages: targetMessages.length,
      completedMissing: 0,
      completedBeforeTool: 0,
      completedBeforeReasoning: 0,
      runningToolsWhenCompleted: 0,
      reasoningOpenWhenCompleted: 0,
      withTools: 0,
      withReasoning: 0,
    }

    const toNumber = (value: unknown): number | null =>
      typeof value === "number" && Number.isFinite(value) ? value : null

    const getLatestTimestamp = (timestamps: Array<number | null>): number | null => {
      const filtered = timestamps.filter((value): value is number => typeof value === "number")
      return filtered.length > 0 ? Math.max(...filtered) : null
    }

    const rows = targetMessages.map((message, index) => {
      const parts = getSyncParts(message.id) || []

      const completedAt = toNumber(getField(getRecordField(message, "time"), "completed"))
      const hasCompleted = completedAt !== null

      const toolParts = parts.filter((part) => getPartType(part) === "tool")
      const reasoningParts = parts.filter((part) => getPartType(part) === "reasoning")

      const latestToolTimestamp = getLatestTimestamp(
        toolParts.map((part) => {
          const time = getRecordField(getRecordField(part, "state"), "time")
          return toNumber(getField(time, "end") ?? getField(time, "start"))
        }),
      )
      const latestReasoningTimestamp = getLatestTimestamp(
        reasoningParts.map((part) => {
          const time = getRecordField(part, "time")
          return toNumber(getField(time, "end") ?? getField(time, "start"))
        }),
      )
      const latestPartTimestamp = getLatestTimestamp(
        [latestToolTimestamp, latestReasoningTimestamp].filter((value) => value !== null),
      )

      const hasRunningTool = toolParts.some((part) => {
        const status = getStringField(getRecordField(part, "state"), "status")
        return status ? ["pending", "running", "started"].includes(status) : false
      })
      const reasoningIncomplete = reasoningParts.some(
        (part) => typeof getNumberField(getRecordField(part, "time"), "end") !== "number",
      )

      if (toolParts.length > 0) {
        summary.withTools += 1
      }
      if (reasoningParts.length > 0) {
        summary.withReasoning += 1
      }

      if (!hasCompleted) {
        summary.completedMissing += 1
      }

      const completedBeforeTool = Boolean(
        hasCompleted && typeof latestToolTimestamp === "number" && completedAt! < latestToolTimestamp,
      )
      if (completedBeforeTool) {
        summary.completedBeforeTool += 1
      }

      const completedBeforeReasoning = Boolean(
        hasCompleted && typeof latestReasoningTimestamp === "number" && completedAt! < latestReasoningTimestamp,
      )
      if (completedBeforeReasoning) {
        summary.completedBeforeReasoning += 1
      }

      if (hasCompleted && hasRunningTool) {
        summary.runningToolsWhenCompleted += 1
      }
      if (hasCompleted && reasoningIncomplete) {
        summary.reasoningOpenWhenCompleted += 1
      }

      return {
        index,
        messageId: message.id,
        role: message.role,
        completedAt,
        latestToolTimestamp,
        latestReasoningTimestamp,
        latestPartTimestamp,
        completed_missing: !hasCompleted,
        completed_before_tool: completedBeforeTool,
        completed_before_reasoning: completedBeforeReasoning,
        running_tools_when_completed: Boolean(hasCompleted && hasRunningTool),
        reasoning_open_when_completed: Boolean(hasCompleted && reasoningIncomplete),
        has_tools: toolParts.length > 0,
        has_reasoning: reasoningParts.length > 0,
      }
    })

    if (verbose) {
      console.table(rows.slice(0, maxTableRows))
      if (rows.length > maxTableRows) {
        console.log(`Displayed first ${maxTableRows} rows out of ${rows.length}.`)
      }
      console.log("[SUMMARY] Message completion timing:", summary)
    }

    return { summary, rows }
  },

  checkCompletionStatus() {
    const state = useSessionUIStore.getState()
    const currentSessionId = state.currentSessionId

    if (!currentSessionId) {
      console.log("[ERROR] No active session")
      return null
    }

    const messages = getSyncMessages(currentSessionId)
    const assistantMessages = messages.filter((m) => m.role === "assistant")

    if (assistantMessages.length === 0) {
      console.log("[ERROR] No assistant messages")
      return null
    }

    const lastMessage = assistantMessages[assistantMessages.length - 1]
    const lastParts = getSyncParts(lastMessage.id) || []
    const stepFinishParts = lastParts.filter((part) => getPartType(part) === "step-finish")
    const hasStopReason = getStringField(lastMessage, "finish") === "stop"

    const completedAt = getField(getRecordField(lastMessage, "time"), "completed")
    const messageStatus = getStringField(lastMessage, "status")
    const hasCompletedFlag = (typeof completedAt === "number" && completedAt > 0) || messageStatus === "completed"
    const messageIsComplete = Boolean(hasCompletedFlag && hasStopReason)

    const streamingState = useStreamingStore.getState()
    const sessionID = getStringField(lastMessage, "sessionID")
    const streamingMessageId = sessionID ? (streamingState.streamingMessageIds.get(sessionID) ?? null) : null
    const lifecycle = streamingState.messageStreamStates.get(lastMessage.id)
    const isStreamingCandidate = lastMessage.id === streamingMessageId

    console.log("[SUMMARY] Completion Status:")
    console.log("Message ID:", lastMessage.id)
    console.log("time.completed:", completedAt, "(type:", typeof completedAt, ")")
    console.log("status:", messageStatus)
    console.log("hasCompletedFlag:", hasCompletedFlag)
    console.log("hasStopReason:", hasStopReason)
    console.log("messageIsComplete:", messageIsComplete)
    console.log("lifecycle phase:", lifecycle?.phase)
    console.log("isStreamingCandidate:", isStreamingCandidate)
    console.log("streamingMessageId:", streamingMessageId)
    console.log("Step-finish parts:", stepFinishParts)

    return {
      messageId: lastMessage.id,
      completed: completedAt,
      status: messageStatus,
      hasCompletedFlag,
      hasStopReason,
      messageIsComplete,
      stepFinishParts,
      raw: lastMessage,
    }
  },
}

if (typeof window !== "undefined") {
  ;(window as unknown as DebugGlobals).__axCodeDebug = debugUtils
  if (streamDebugEnabled()) {
    console.log("[DEBUG] ax-code Debug Utils loaded! Use window.__axCodeDebug in console")
    console.log("Available commands:")
    console.log("  __axCodeDebug.getLastAssistantMessage() - Get last assistant message details")
    console.log("  __axCodeDebug.getAllMessages(truncate?) - List all messages (truncate=true for short preview)")
    console.log("  __axCodeDebug.truncateMessages(messages) - Truncate long fields in messages array")
    console.log("  __axCodeDebug.getAppStatus() - Show app status snapshot")
    console.log("  __axCodeDebug.checkLastMessage() - Check if last message is problematic")
    console.log("  __axCodeDebug.findEmptyMessages() - Find all empty assistant messages")
    console.log("  __axCodeDebug.showRetryHelp() - Show instructions for handling empty responses")
    console.log("  __axCodeDebug.getStreamingState() - Get streaming state info")
    console.log("  __axCodeDebug.analyzeMessageCompletionConsistency(opts?) - Compare time.completed vs part timings")
    console.log("  __axCodeDebug.checkCompletionStatus() - Check completion status of last message")
  }

  window.addEventListener("error", (event) => {
    try {
      const message = event.message || ""
      const source = event.filename || ""
      if (
        typeof message === "string" &&
        message.includes("this._renderer.value.dimensions") &&
        /xterm/i.test(String(source))
      ) {
        event.preventDefault()
      }
    } catch {
      /* ignored */
    }
  })
}
