import type { AppPart, AppStatus } from "../projection/types"
import { getToolLifecycleState, normalizeToolStatus } from "./tool-status"

export type AssistantActivity = "idle" | "streaming" | "tooling" | "cooldown" | "permission" | "question"

export type WorkingSummary = {
  activity: AssistantActivity
  hasWorkingContext: boolean
  hasActiveTools: boolean
  isWorking: boolean
  isStreaming: boolean
  isCooldown: boolean
  lifecyclePhase: "streaming" | "cooldown" | null
  statusText: string | null
  isGenericStatus: boolean
  isWaitingForPermission: boolean
  isWaitingForQuestion: boolean
  canAbort: boolean
  compactionDeadline: number | null
  activePartType: "text" | "tool" | "reasoning" | "editing" | undefined
  activeToolName: string | undefined
  wasAborted: boolean
  abortActive: boolean
  lastCompletionId: string | null
  isComplete: boolean
  retryInfo: { attempt?: number; next?: number } | null
  waitState: "llm" | "tool" | undefined
  step: number | undefined
  maxSteps: number | undefined
}

export type FormingSummary = {
  isActive: boolean
  characterCount: number
}

export type AssistantStatusSnapshot = {
  forming: FormingSummary
  working: WorkingSummary
}

const EDITING_TOOLS = new Set(["edit", "write", "multiedit", "apply_patch"])

const TOOL_STATUS_PHRASES: Record<string, string> = {
  read: "reading file",
  write: "writing file",
  edit: "editing file",
  multiedit: "editing files",
  apply_patch: "applying patch",
  bash: "running command",
  grep: "searching content",
  glob: "finding files",
  list: "listing directory",
  task: "delegating task",
  webfetch: "fetching URL",
  websearch: "searching web",
  codesearch: "web code search",
  todowrite: "updating todos",
  todoread: "reading todos",
  skill: "learning skill",
  question: "asking question",
  plan_enter: "switching to planning",
  plan_exit: "switching to building",
}

const WORKING_PHRASES = [
  "working",
  "processing",
  "preparing",
  "warming up",
  "computing",
  "calculating",
  "analyzing",
  "calibrating",
  "synthesizing",
  "inspecting logic",
  "weighing options",
]

const hashString = (value: string): number => {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

const getStableWorkingPhrase = (key: string): string => {
  return WORKING_PHRASES[hashString(key) % WORKING_PHRASES.length] ?? "working"
}

const getToolStatusPhrase = (toolName: string): string => {
  return TOOL_STATUS_PHRASES[toolName] ?? `using ${toolName}`
}

type ParsedActiveState = {
  activePartType: "text" | "tool" | "reasoning" | "editing" | undefined
  activeToolName: string | undefined
  statusText: string
  isGenericStatus: boolean
}

function computeParsedActiveState(parts: AppPart[], genericKey: string): ParsedActiveState {
  let activePartType: ParsedActiveState["activePartType"] = undefined
  let activeToolName: string | undefined = undefined

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (!part) continue

    switch (part.type) {
      case "reasoning": {
        if (!activePartType) {
          activePartType = "reasoning"
        }
        break
      }
      case "tool": {
        const toolName = part.toolName ?? "tool"
        const lifecycle = getToolLifecycleState({
          status: part.text,
          time: undefined,
        })
        const rawStatus = normalizeToolStatus(part.text)
        const isActive = lifecycle.isInFlight || rawStatus === "running" || rawStatus === "pending"
        if (isActive && !activePartType) {
          if (EDITING_TOOLS.has(toolName)) {
            activePartType = "editing"
            activeToolName = toolName
          } else {
            activePartType = "tool"
            activeToolName = toolName
          }
        }
        break
      }
      case "text": {
        const hasContent = typeof part.text === "string" && part.text.trim().length > 0
        if (hasContent && !activePartType) {
          activePartType = "text"
        }
        break
      }
    }
  }

  const isGenericStatus = activePartType === undefined
  const statusText = (() => {
    if (activePartType === "editing")
      return activeToolName === "multiedit" ? getToolStatusPhrase(activeToolName) : "editing file"
    if (activePartType === "tool" && activeToolName) return getToolStatusPhrase(activeToolName)
    if (activePartType === "reasoning") return "thinking"
    if (activePartType === "text") return "composing"
    return getStableWorkingPhrase(genericKey)
  })()

  return { activePartType, activeToolName, statusText, isGenericStatus }
}

const DEFAULT_WORKING: WorkingSummary = {
  activity: "idle",
  hasWorkingContext: false,
  hasActiveTools: false,
  isWorking: false,
  isStreaming: false,
  isCooldown: false,
  lifecyclePhase: null,
  statusText: null,
  isGenericStatus: true,
  isWaitingForPermission: false,
  isWaitingForQuestion: false,
  canAbort: false,
  compactionDeadline: null,
  activePartType: undefined,
  activeToolName: undefined,
  wasAborted: false,
  abortActive: false,
  lastCompletionId: null,
  isComplete: false,
  retryInfo: null,
  waitState: undefined,
  step: undefined,
  maxSteps: undefined,
}

export function computeAssistantStatus(input: {
  status: AppStatus | undefined
  lastAssistantParts: AppPart[]
  sessionId: string | undefined
  pendingPermissions: unknown[]
  pendingQuestions: unknown[]
  abortBusy: boolean
}): AssistantStatusSnapshot {
  const { status, lastAssistantParts, sessionId, pendingPermissions, pendingQuestions, abortBusy } = input

  if (abortBusy) {
    return {
      forming: { isActive: false, characterCount: 0 },
      working: {
        ...DEFAULT_WORKING,
        wasAborted: true,
        abortActive: true,
        activity: "idle",
        isWorking: false,
        canAbort: false,
      },
    }
  }

  const isWorking = status?.type === "busy"
  const isBlocked = status?.type === "blocked"
  const isFailed = status?.type === "failed"

  const waitState = status?.type === "busy" ? status.waitState : undefined
  const step = status?.type === "busy" ? status.step : undefined
  const maxSteps = status?.type === "busy" ? status.maxSteps : undefined

  const genericKey = `${sessionId ?? ""}:status`
  const parsed = computeParsedActiveState(lastAssistantParts, genericKey)

  const isWaitingForPermission =
    isBlocked && (status as Extract<AppStatus, { type: "blocked" }>)?.reason === "permission"
  const isWaitingForQuestion = isBlocked && (status as Extract<AppStatus, { type: "blocked" }>)?.reason === "question"

  const hasPendingPermission = pendingPermissions.length > 0 || isWaitingForPermission
  const hasPendingQuestion = pendingQuestions.length > 0 || isWaitingForQuestion

  const activity: AssistantActivity = (() => {
    if (hasPendingPermission) return "permission"
    if (hasPendingQuestion) return "question"
    if (!isWorking) return "idle"
    if (parsed.activePartType === "tool" || parsed.activePartType === "editing") return "tooling"
    return "streaming"
  })()

  const resolvedStatusText = (() => {
    if (hasPendingPermission) return "waiting for permission"
    if (hasPendingQuestion) return "waiting for answer"
    if (!isWorking) return null
    return parsed.statusText
  })()

  const working: WorkingSummary = {
    activity,
    hasWorkingContext: isWorking,
    hasActiveTools: parsed.activePartType === "tool" || parsed.activePartType === "editing",
    isWorking,
    isStreaming: isWorking && activity === "streaming",
    isCooldown: false,
    lifecyclePhase: isWorking ? (activity === "streaming" ? "streaming" : null) : null,
    statusText: resolvedStatusText,
    isGenericStatus: isWorking ? parsed.isGenericStatus : true,
    isWaitingForPermission: hasPendingPermission,
    isWaitingForQuestion: hasPendingQuestion,
    canAbort: isWorking || isBlocked,
    compactionDeadline: null,
    activePartType: isWorking ? parsed.activePartType : undefined,
    activeToolName: isWorking ? parsed.activeToolName : undefined,
    wasAborted: false,
    abortActive: false,
    lastCompletionId: null,
    isComplete: status?.type === "idle",
    retryInfo: null,
    waitState,
    step,
    maxSteps,
  }

  const forming: FormingSummary = {
    isActive: isWorking && parsed.activePartType === "text",
    characterCount: 0,
  }

  return { forming, working }
}
