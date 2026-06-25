import {
  RequestError,
  type Agent as ACPAgent,
  type AgentSideConnection,
  type AuthenticateRequest,
  type AuthMethod,
  type CancelNotification,
  type ForkSessionRequest,
  type ForkSessionResponse,
  type InitializeRequest,
  type InitializeResponse,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type LoadSessionRequest,
  type NewSessionRequest,
  type PermissionOption,
  type PlanEntry,
  type PromptRequest,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type Role,
  type SessionInfo,
  type SetSessionModelRequest,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
  type ToolCallContent,
  type Usage,
} from "@agentclientprotocol/sdk"

import { Log } from "../util/log"
import { pathToFileURL } from "url"
import { Filesystem } from "../util/filesystem"
import { FileTime } from "../file/time"
import { Hash } from "../util/hash"
import { Lock } from "../util/lock"
import { ACPSessionManager } from "./session"
import type { ACPConfig, ACPSessionState } from "./types"
import { providerModelKey } from "../provider/model-key"
import { ModelID, ProviderID } from "../provider/schema"
import { Agent as AgentModule } from "../agent/agent"
import { Installation } from "@/installation"
import { MessageV2 } from "@/session/message-v2"
import { LoadAPIKeyError } from "ai"
import type {
  Event,
  OpencodeClient,
  SessionMessageResponse,
  ToolPart,
  ToolStateCompleted,
  ToolStateError,
  ToolStateRunning,
} from "@ax-code/sdk/v2"
import {
  buildVariantMeta,
  defaultModel,
  getNewContent,
  modelVariantsFromProviders,
  parseModelSelection,
  sortProvidersByName,
  toLocations,
  toToolKind,
} from "./agent-adapter"
import {
  decodeReplayDataUrl as _decodeReplayDataUrl,
  decodeTodoPlanEntries as _decodeTodoPlanEntries,
  isHttpUri,
  parseListSessionsCursor as _parseListSessionsCursor,
  parseTodoPlanEntries as _parseTodoPlanEntries,
  sessionUpdatedMs,
  uriProtocol,
} from "./utils"
import { sendUsageUpdate } from "./usage"
import { buildUsage, parsePromptParts, parseSlashCommand } from "./prompt"
import { loadAvailableModes, loadSessionMode } from "./session-mode"

export {
  _decodeTodoPlanEntries as decodeTodoPlanEntries,
  _parseTodoPlanEntries as parseTodoPlanEntries,
  _decodeReplayDataUrl as decodeReplayDataUrl,
  _parseListSessionsCursor as parseListSessionsCursor,
}

export namespace ACP {
  const log = Log.create({ service: "acp-agent" })
  const PERMISSION_LOCK_TIMEOUT_MS = 24 * 60 * 60 * 1000
  type PermissionAsked = Extract<Event, { type: "permission.asked" }>['properties']

  // Re-exported for backward compatibility (tests and external consumers)
  export const decodeTodoPlanEntries = _decodeTodoPlanEntries
  export const parseTodoPlanEntries = _parseTodoPlanEntries
  export const decodeReplayDataUrl = _decodeReplayDataUrl
  export const parseListSessionsCursor = _parseListSessionsCursor

  export async function init({ sdk: _sdk }: { sdk: OpencodeClient }) {
    return {
      create: (connection: AgentSideConnection, fullConfig: ACPConfig) => {
        return new Agent(connection, fullConfig)
      },
    }
  }

  export class Agent implements ACPAgent {
    private connection: AgentSideConnection
    private config: ACPConfig
    private sdk: OpencodeClient
    private sessionManager: ACPSessionManager
    private eventAbort = new AbortController()
    private eventStarted = false
    private bashSnapshots = new Map<string, string>()
    private toolStarts = new Set<string>()
    private replaying = new Set<string>()
    private replayQueue = new Map<string, Event[]>()
    private static readonly REPLAY_QUEUE_MAX = 500
    private pendingSessionUpdates = new Set<ReturnType<typeof setTimeout>>()
    private permissionOptions: PermissionOption[] = [
      { optionId: "once", kind: "allow_once", name: "Allow once" },
      { optionId: "always", kind: "allow_always", name: "Always allow" },
      { optionId: "reject", kind: "reject_once", name: "Reject" },
    ]

    constructor(connection: AgentSideConnection, config: ACPConfig) {
      this.connection = connection
      this.config = config
      this.sdk = config.sdk
      this.sessionManager = new ACPSessionManager(this.sdk)
      this.connection.signal.addEventListener("abort", () => this.dispose(), { once: true })
      this.startEventSubscription()
    }

    private startEventSubscription() {
      if (this.eventStarted) return
      this.eventStarted = true
      this.runEventSubscription().catch((error) => {
        if (this.eventAbort.signal.aborted) return
        log.error("event subscription failed", { error })
      })
    }

    private async runEventSubscription() {
      while (true) {
        if (this.eventAbort.signal.aborted) return
        const events = await this.sdk.global.event({ signal: this.eventAbort.signal })
        for await (const event of events.stream) {
          if (this.eventAbort.signal.aborted) return
          const payload = (event as any)?.payload
          if (!payload) continue
          await this.handleEvent(payload as Event).catch((error) => {
            log.error("failed to handle event", { error, type: payload.type })
          })
        }
      }
    }

    dispose() {
      if (this.eventAbort.signal.aborted) return
      this.eventAbort.abort()
      this.bashSnapshots.clear()
      this.toolStarts.clear()
      this.replaying.clear()
      this.replayQueue.clear()
      this.sessionManager.clear()
      for (const timer of this.pendingSessionUpdates) clearTimeout(timer)
      this.pendingSessionUpdates.clear()
    }

    private async handleEvent(event: Event) {
      const sessionId = this.eventSession(event)
      if (sessionId && this.replaying.has(sessionId)) {
        const queued = this.replayQueue.get(sessionId) ?? []
        if (queued.length >= Agent.REPLAY_QUEUE_MAX) {
          const dropped = queued.shift()
          log.warn("replayQueue overflow — dropping oldest event", {
            sessionId,
            cap: Agent.REPLAY_QUEUE_MAX,
            droppedType: (dropped as { type?: string } | undefined)?.type,
          })
        }
        queued.push(event)
        this.replayQueue.set(sessionId, queued)
        return
      }
      switch (event.type) {
        case "permission.asked": {
          const permission = event.properties
          const session = this.sessionManager.tryGet(permission.sessionID)
          if (!session) return
          this.handlePermissionAsked(permission, session)
          return
        }
        case "message.part.updated": {
          log.info("message part updated", { event: event.properties })
          const props = event.properties
          const part = props.part
          const session = this.sessionManager.tryGet(part.sessionID)
          if (!session) return
          const sessionId = session.id
          if (part.type === "tool") {
            await this.toolStart(sessionId, part)
            switch (part.state.status) {
              case "pending":
                this.bashSnapshots.delete(part.callID)
                return
              case "running":
                await this.emitToolRunning(sessionId, part as ToolPart & { state: ToolStateRunning })
                return
              case "completed":
                await this.emitToolCompleted(sessionId, part as ToolPart & { state: ToolStateCompleted })
                return
              case "error":
                await this.emitToolError(sessionId, part as ToolPart & { state: ToolStateError })
                return
            }
          }
          return
        }
        case "message.part.delta": {
          const props = event.properties
          const session = this.sessionManager.tryGet(props.sessionID)
          if (!session) return
          const sessionId = session.id
          const message = await this.sdk.session
            .message({ sessionID: props.sessionID, messageID: props.messageID, directory: session.cwd }, { throwOnError: true })
            .then((x) => x.data)
            .catch((error) => {
              log.error("unexpected error when fetching message", { error })
              return undefined
            })
          if (!message || message.info.role !== "assistant") return
          const part = message.parts.find((p) => p.id === props.partID)
          if (!part) return
          if (part.type === "text" && props.field === "text" && part.ignored !== true) {
            await this.connection
              .sessionUpdate({
                sessionId,
                update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: props.delta } },
              })
              .catch((error) => { log.error("failed to send text delta to ACP", { error }) })
            return
          }
          if (part.type === "reasoning" && props.field === "text") {
            await this.connection
              .sessionUpdate({
                sessionId,
                update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: props.delta } },
              })
              .catch((error) => { log.error("failed to send reasoning delta to ACP", { error }) })
          }
          return
        }
      }
    }

    async initialize(params: InitializeRequest): Promise<InitializeResponse> {
      log.info("initialize", { protocolVersion: params.protocolVersion })
      const authMethod: AuthMethod = {
        description: "Run `ax-code auth login` in the terminal",
        name: "Login with ax-code",
        id: "ax-code-login",
      }
      if (params.clientCapabilities?._meta?.["terminal-auth"] === true) {
        authMethod._meta = {
          "terminal-auth": { command: "ax-code", args: ["auth", "login"], label: "ax-code Login" },
        }
      }
      return {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          mcpCapabilities: { http: true, sse: true },
          promptCapabilities: { embeddedContext: true, image: true },
          sessionCapabilities: { fork: {}, list: {}, resume: {} },
        },
        authMethods: [authMethod],
        agentInfo: { name: "ax-code", version: Installation.VERSION },
      }
    }

    async authenticate(_params: AuthenticateRequest) {
      throw RequestError.methodNotFound("authenticate")
    }

    async newSession(params: NewSessionRequest) {
      const directory = params.cwd
      try {
        const model = await defaultModel(this.config, directory)
        const state = await this.sessionManager.create(params.cwd, params.mcpServers, model)
        const sessionId = state.id
        log.info("creating_session", { sessionId, mcpServers: params.mcpServers.length })
        const load = await loadSessionMode(
          { cwd: directory, mcpServers: params.mcpServers, sessionId },
          this.config, this.connection, this.sessionManager, this.pendingSessionUpdates, this.eventAbort,
        )
        return { sessionId, models: load.models, modes: load.modes, _meta: load._meta }
      } catch (e) {
        const error = MessageV2.fromError(e, { providerID: ProviderID.make(this.config.defaultModel?.providerID ?? "unknown") })
        if (LoadAPIKeyError.isInstance(error)) throw RequestError.authRequired()
        throw e
      }
    }

    async loadSession(params: LoadSessionRequest) {
      const directory = params.cwd
      const sessionId = params.sessionId
      try {
        const model = await defaultModel(this.config, directory)
        await this.sessionManager.load(sessionId, params.cwd, params.mcpServers, model)
        log.info("load_session", { sessionId, mcpServers: params.mcpServers.length })
        const result = await loadSessionMode(
          { cwd: directory, mcpServers: params.mcpServers, sessionId },
          this.config, this.connection, this.sessionManager, this.pendingSessionUpdates, this.eventAbort,
        )
        this.beginReplay(sessionId)
        const messages = await this.sdk.session
          .messages({ sessionID: sessionId, directory }, { throwOnError: true })
          .then((x) => x.data)
          .catch((err) => { log.error("unexpected error when fetching message", { error: err }); return undefined })
        const lastUser = messages?.findLast((m) => m.info.role === "user")?.info
        if (lastUser?.role === "user") {
          result.models.currentModelId = providerModelKey(lastUser.model)
          this.sessionManager.setModel(sessionId, {
            providerID: ProviderID.make(lastUser.model.providerID),
            modelID: ModelID.make(lastUser.model.modelID),
          })
          if (result.modes?.availableModes?.some((m) => m.id === lastUser.agent)) {
            result.modes.currentModeId = lastUser.agent
            this.sessionManager.setMode(sessionId, lastUser.agent)
          }
        }
        try {
          for (const msg of messages ?? []) {
            log.debug("replay message", msg)
            await this.processMessage(msg)
          }
        } finally {
          await this.endReplay(sessionId)
        }
        await sendUsageUpdate(this.connection, this.sdk, sessionId, directory)
        return result
      } catch (e) {
        const error = MessageV2.fromError(e, { providerID: ProviderID.make(this.config.defaultModel?.providerID ?? "unknown") })
        if (LoadAPIKeyError.isInstance(error)) throw RequestError.authRequired()
        throw e
      }
    }

    async unstable_listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
      try {
        const cursor = parseListSessionsCursor(params.cursor)
        const limit = 100
        const sessions = await this.sdk.session
          .list({ directory: params.cwd ?? undefined, roots: true }, { throwOnError: true })
          .then((x) => x.data ?? [])
        const sorted = sessions.toSorted((a, b) => sessionUpdatedMs(b) - sessionUpdatedMs(a))
        const filtered = cursor !== undefined ? sorted.filter((s) => sessionUpdatedMs(s) < cursor) : sorted
        const page = filtered.slice(0, limit)
        const entries: SessionInfo[] = page.map((session) => ({
          sessionId: session.id, cwd: session.directory, title: session.title,
          updatedAt: new Date(sessionUpdatedMs(session)).toISOString(),
        }))
        const last = page[page.length - 1]
        const next = filtered.length > limit && last ? String(sessionUpdatedMs(last)) : undefined
        const response: ListSessionsResponse = { sessions: entries }
        if (next) response.nextCursor = next
        return response
      } catch (e) {
        const error = MessageV2.fromError(e, { providerID: ProviderID.make(this.config.defaultModel?.providerID ?? "unknown") })
        if (LoadAPIKeyError.isInstance(error)) throw RequestError.authRequired()
        throw e
      }
    }

    async unstable_forkSession(params: ForkSessionRequest): Promise<ForkSessionResponse> {
      const directory = params.cwd
      const mcpServers = params.mcpServers ?? []
      try {
        const model = await defaultModel(this.config, directory)
        const forked = await this.sdk.session
          .fork({ sessionID: params.sessionId, directory }, { throwOnError: true })
          .then((x) => x.data)
        if (!forked) throw new Error("Fork session returned no data")
        const sessionId = forked.id
        await this.sessionManager.load(sessionId, directory, mcpServers, model)
        log.info("fork_session", { sessionId, mcpServers: mcpServers.length })
        const mode = await loadSessionMode(
          { cwd: directory, mcpServers, sessionId },
          this.config, this.connection, this.sessionManager, this.pendingSessionUpdates, this.eventAbort,
        )
        this.beginReplay(sessionId)
        const messages = await this.sdk.session
          .messages({ sessionID: sessionId, directory }, { throwOnError: true })
          .then((x) => x.data)
          .catch((err) => { log.error("unexpected error when fetching message", { error: err }); return undefined })
        try {
          for (const msg of messages ?? []) {
            log.debug("replay message", msg)
            await this.processMessage(msg)
          }
        } finally { await this.endReplay(sessionId) }
        await sendUsageUpdate(this.connection, this.sdk, sessionId, directory)
        return mode
      } catch (e) {
        const error = MessageV2.fromError(e, { providerID: ProviderID.make(this.config.defaultModel?.providerID ?? "unknown") })
        if (LoadAPIKeyError.isInstance(error)) throw RequestError.authRequired()
        throw e
      }
    }

    async unstable_resumeSession(params: ResumeSessionRequest): Promise<ResumeSessionResponse> {
      const directory = params.cwd
      const sessionId = params.sessionId
      const mcpServers = params.mcpServers ?? []
      try {
        const model = await defaultModel(this.config, directory)
        await this.sessionManager.load(sessionId, directory, mcpServers, model)
        log.info("resume_session", { sessionId, mcpServers: mcpServers.length })
        const result = await loadSessionMode(
          { cwd: directory, mcpServers, sessionId },
          this.config, this.connection, this.sessionManager, this.pendingSessionUpdates, this.eventAbort,
        )
        await sendUsageUpdate(this.connection, this.sdk, sessionId, directory)
        return result
      } catch (e) {
        const error = MessageV2.fromError(e, { providerID: ProviderID.make(this.config.defaultModel?.providerID ?? "unknown") })
        if (LoadAPIKeyError.isInstance(error)) throw RequestError.authRequired()
        throw e
      }
    }

    private async processMessage(message: SessionMessageResponse) {
      log.debug("process message", message)
      if (message.info.role !== "assistant" && message.info.role !== "user") return
      const sessionId = message.info.sessionID
      for (const part of message.parts) {
        if (part.type === "tool") {
          await this.toolStart(sessionId, part)
          switch (part.state.status) {
            case "pending": this.bashSnapshots.delete(part.callID); break
            case "running": await this.emitToolRunning(sessionId, part as ToolPart & { state: ToolStateRunning }); break
            case "completed": await this.emitToolCompleted(sessionId, part as ToolPart & { state: ToolStateCompleted }); break
            case "error": await this.emitToolError(sessionId, part as ToolPart & { state: ToolStateError }); break
          }
        } else if (part.type === "text") {
          if (part.text) {
            const audience: Role[] | undefined = part.synthetic ? ["assistant"] : part.ignored ? ["user"] : undefined
            await this.connection.sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: message.info.role === "user" ? "user_message_chunk" : "agent_message_chunk",
                content: { type: "text", text: part.text, ...(audience && { annotations: { audience } }) },
              },
            }).catch((err) => { log.error("failed to send text to ACP", { error: err }) })
          }
        } else if (part.type === "file") {
          const url = part.url
          const filename = part.filename ?? "file"
          const mime = part.mime || "application/octet-stream"
          const messageChunk = message.info.role === "user" ? "user_message_chunk" : "agent_message_chunk"
          const protocol = uriProtocol(url)
          if (protocol === "file:") {
            await this.connection.sessionUpdate({
              sessionId,
              update: { sessionUpdate: messageChunk, content: { type: "resource_link", uri: url, name: filename, mimeType: mime } },
            }).catch((err) => { log.error("failed to send resource_link to ACP", { error: err }) })
          } else if (protocol === "data:") {
            const decoded = decodeReplayDataUrl(url, mime)
            const effectiveMime = decoded.mimeType
            if (effectiveMime.startsWith("image/")) {
              await this.connection.sessionUpdate({
                sessionId,
                update: {
                  sessionUpdate: messageChunk,
                  content: { type: "image", mimeType: effectiveMime, data: decoded.base64Data, uri: pathToFileURL(filename).href },
                },
              }).catch((err) => { log.error("failed to send image to ACP", { error: err }) })
            } else {
              const isText = effectiveMime.startsWith("text/") || effectiveMime === "application/json"
              const fileUri = pathToFileURL(filename).href
              const resource = isText
                ? { uri: fileUri, mimeType: effectiveMime, text: decoded.text }
                : { uri: fileUri, mimeType: effectiveMime, blob: decoded.base64Data }
              await this.connection.sessionUpdate({
                sessionId,
                update: { sessionUpdate: messageChunk, content: { type: "resource", resource } },
              }).catch((err) => { log.error("failed to send resource to ACP", { error: err }) })
            }
          }
        } else if (part.type === "reasoning") {
          if (part.text) {
            await this.connection.sessionUpdate({
              sessionId,
              update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: part.text } },
            }).catch((err) => { log.error("failed to send reasoning to ACP", { error: err }) })
          }
        }
      }
    }

    private handlePermissionAsked(permission: PermissionAsked, session: ACPSessionState) {
      void this.runPermissionRequest(permission, session).catch((error) => {
        log.error("failed to handle permission", { error, permissionID: permission.id })
      })
    }

    private async runPermissionRequest(permission: PermissionAsked, session: ACPSessionState) {
      using _lock = await Lock.write(`acp:permission:${permission.sessionID}`, { timeoutMs: PERMISSION_LOCK_TIMEOUT_MS })
      const directory = session.cwd
      const res = await this.connection.requestPermission({
        sessionId: permission.sessionID,
        toolCall: {
          toolCallId: permission.tool?.callID ?? permission.id,
          status: "pending", title: permission.permission,
          rawInput: permission.metadata, kind: toToolKind(permission.permission),
          locations: toLocations(permission.permission, permission.metadata),
        },
        options: this.permissionOptions,
      }).catch(async (error) => {
        log.error("failed to request permission from ACP", { error, permissionID: permission.id, sessionID: permission.sessionID })
        await this.sdk.permission.reply({ requestID: permission.id, reply: "reject", directory })
        return undefined
      })
      if (!res) return
      if (res.outcome.outcome !== "selected") {
        await this.sdk.permission.reply({ requestID: permission.id, reply: "reject", directory })
        return
      }
      if (res.outcome.optionId !== "reject" && permission.permission === "edit") {
        const metadata = permission.metadata || {}
        const filepath = typeof metadata["filepath"] === "string" ? metadata["filepath"] : ""
        const diff = typeof metadata["diff"] === "string" ? metadata["diff"] : ""
        if (filepath) {
          await FileTime.withLock(filepath, async () => {
            const content = (await Filesystem.exists(filepath)) ? await Filesystem.readText(filepath) : ""
            const newContent = getNewContent(content, diff)
            if (newContent) {
              await this.connection.writeTextFile({ sessionId: session.id, path: filepath, content: newContent })
            }
          }).catch((error) => {
            log.error("failed to apply ACP optimistic edit write", { error, permissionID: permission.id, sessionID: permission.sessionID })
          })
        }
      }
      await this.sdk.permission.reply({
        requestID: permission.id,
        reply: res.outcome.optionId as "once" | "always" | "reject",
        directory,
      })
    }

    private bashOutput(part: ToolPart) {
      if (part.tool !== "bash") return
      if (!("metadata" in part.state) || !part.state.metadata || typeof part.state.metadata !== "object") return
      const output = part.state.metadata["output"]
      if (typeof output !== "string") return
      return output
    }

    private todosToPlanEntries(rawOutput: string): PlanEntry[] | null {
      return parseTodoPlanEntries(rawOutput)
    }

    private async emitToolRunning(sessionId: string, part: ToolPart & { state: ToolStateRunning }): Promise<void> {
      const output = this.bashOutput(part)
      const content: ToolCallContent[] = []
      if (output) {
        const hash = Hash.fast(output)
        if (part.tool === "bash") {
          if (this.bashSnapshots.get(part.callID) === hash) {
            await this.connection.sessionUpdate({
              sessionId, update: {
                sessionUpdate: "tool_call_update", toolCallId: part.callID, status: "in_progress",
                kind: toToolKind(part.tool), title: part.tool,
                locations: toLocations(part.tool, part.state.input), rawInput: part.state.input,
              },
            }).catch((error) => { log.error("failed to send tool in_progress to ACP", { error }) })
            return
          }
          this.bashSnapshots.set(part.callID, hash)
        }
        content.push({ type: "content", content: { type: "text", text: output } })
      }
      await this.connection.sessionUpdate({
        sessionId, update: {
          sessionUpdate: "tool_call_update", toolCallId: part.callID, status: "in_progress",
          kind: toToolKind(part.tool), title: part.tool,
          locations: toLocations(part.tool, part.state.input), rawInput: part.state.input,
          ...(content.length > 0 && { content }),
        },
      }).catch((error) => { log.error("failed to send tool in_progress to ACP", { error }) })
    }

    private async emitToolCompleted(sessionId: string, part: ToolPart & { state: ToolStateCompleted }): Promise<void> {
      this.toolStarts.delete(part.callID)
      this.bashSnapshots.delete(part.callID)
      const kind = toToolKind(part.tool)
      const content: ToolCallContent[] = [{ type: "content", content: { type: "text", text: part.state.output } }]
      if (kind === "edit") {
        const input = part.state.input
        const filePath = typeof input["filePath"] === "string" ? input["filePath"] : ""
        const oldText = typeof input["oldString"] === "string" ? input["oldString"] : ""
        const newText = typeof input["newString"] === "string" ? input["newString"]
          : typeof input["content"] === "string" ? input["content"] : ""
        content.push({ type: "diff", path: filePath, oldText, newText })
      }
      if (part.tool === "todowrite") {
        const entries = this.todosToPlanEntries(part.state.output)
        if (entries) {
          await this.connection.sessionUpdate({
            sessionId, update: { sessionUpdate: "plan", entries },
          }).catch((error) => { log.error("failed to send session update for todo", { error }) })
        }
      }
      await this.connection.sessionUpdate({
        sessionId, update: {
          sessionUpdate: "tool_call_update", toolCallId: part.callID, status: "completed",
          kind, content, title: part.state.title, rawInput: part.state.input,
          rawOutput: { output: part.state.output, metadata: part.state.metadata },
        },
      }).catch((error) => { log.error("failed to send tool completed to ACP", { error }) })
    }

    private async emitToolError(sessionId: string, part: ToolPart & { state: ToolStateError }): Promise<void> {
      this.toolStarts.delete(part.callID)
      this.bashSnapshots.delete(part.callID)
      await this.connection.sessionUpdate({
        sessionId, update: {
          sessionUpdate: "tool_call_update", toolCallId: part.callID, status: "failed",
          kind: toToolKind(part.tool), title: part.tool, rawInput: part.state.input,
          content: [{ type: "content", content: { type: "text", text: part.state.error } }],
          rawOutput: { error: part.state.error, metadata: part.state.metadata },
        },
      }).catch((error) => { log.error("failed to send tool error to ACP", { error }) })
    }

    private async toolStart(sessionId: string, part: ToolPart) {
      if (this.toolStarts.has(part.callID)) return
      this.toolStarts.add(part.callID)
      await this.connection.sessionUpdate({
        sessionId, update: {
          sessionUpdate: "tool_call", toolCallId: part.callID, title: part.tool,
          kind: toToolKind(part.tool), status: "pending", locations: [], rawInput: {},
        },
      }).catch((error) => { log.error("failed to send tool pending to ACP", { error }) })
    }

    private eventSession(event: Event) {
      switch (event.type) {
        case "permission.asked": return event.properties.sessionID
        case "message.part.updated": return event.properties.part.sessionID
        case "message.part.delta": return event.properties.sessionID
      }
    }

    private beginReplay(sessionId: string) {
      this.replaying.add(sessionId)
      this.replayQueue.delete(sessionId)
    }

    private async endReplay(sessionId: string) {
      this.replaying.delete(sessionId)
      const queued = this.replayQueue.get(sessionId) ?? []
      this.replayQueue.delete(sessionId)
      for (const event of queued) {
        if (this.skipQueuedReplayEvent(event)) continue
        await this.handleEvent(event)
      }
    }

    private skipQueuedReplayEvent(event: Event) {
      if (event.type !== "message.part.updated") return false
      const part = event.properties.part
      if (part.type !== "tool") return false
      if (part.state.status !== "running") return false
      if (part.tool !== "bash") return false
      const output = this.bashOutput(part)
      if (!output) return false
      return this.bashSnapshots.get(part.callID) === Hash.fast(output)
    }

    async unstable_setSessionModel(params: SetSessionModelRequest) {
      const session = this.sessionManager.get(params.sessionId)
      if (!session) throw new Error(`ACP unstable_setSessionModel: unknown session ${params.sessionId}`)
      const providersResp = await this.sdk.config.providers({ directory: session.cwd }, { throwOnError: true })
      if (!providersResp.data?.providers)
        throw new Error(`ACP unstable_setSessionModel: empty providers response for ${session.cwd}`)
      const providers = providersResp.data.providers
      const selection = parseModelSelection(params.modelId, providers)
      this.sessionManager.setModel(session.id, selection.model)
      this.sessionManager.setVariant(session.id, selection.variant)
      const entries = sortProvidersByName(providers)
      const availableVariants = modelVariantsFromProviders(entries, selection.model)
      return {
        _meta: buildVariantMeta({ model: selection.model, variant: selection.variant, availableVariants }),
      }
    }

    async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse | void> {
      const session = this.sessionManager.get(params.sessionId)
      if (!session) throw new Error(`ACP setSessionMode: unknown session ${params.sessionId}`)
      const availableModes = await loadAvailableModes(this.sdk, session.cwd)
      if (!availableModes.some((mode) => mode.id === params.modeId))
        throw new Error(`Agent not found: ${params.modeId}`)
      this.sessionManager.setMode(params.sessionId, params.modeId)
    }

    async prompt(params: PromptRequest) {
      const sessionID = params.sessionId
      const session = this.sessionManager.get(sessionID)
      if (!session) throw new Error(`ACP prompt: unknown session ${sessionID}`)
      const directory = session.cwd
      const current = session.model
      const model = current ?? (await defaultModel(this.config, directory))
      if (!current) this.sessionManager.setModel(session.id, model)
      const agent = session.modeId ?? (await AgentModule.defaultAgent())
      const parts = parsePromptParts(params.prompt)
      log.info("parts", { parts })
      const textContent = parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text).join("").trim()
      const cmd = parseSlashCommand(textContent)
      if (!cmd) {
        const response = await this.sdk.session.prompt({
          sessionID,
          model: { providerID: model.providerID, modelID: model.modelID },
          variant: this.sessionManager.getVariant(sessionID),
          parts, agent, directory,
        })
        const msg = response.data?.info
        await sendUsageUpdate(this.connection, this.sdk, sessionID, directory)
        return { stopReason: "end_turn" as const, usage: msg ? buildUsage(msg) : undefined, _meta: {} }
      }
      const commandResp = await this.config.sdk.command.list({ directory }, { throwOnError: true })
      if (!commandResp.data) throw new Error(`ACP command.list: empty response for ${directory}`)
      const command = commandResp.data.find((c) => c.name === cmd.name)
      if (command) {
        const response = await this.sdk.session.command({
          sessionID, command: command.name, arguments: cmd.args,
          model: providerModelKey(model), agent, directory,
        })
        const msg = response.data?.info
        await sendUsageUpdate(this.connection, this.sdk, sessionID, directory)
        return { stopReason: "end_turn" as const, usage: msg ? buildUsage(msg) : undefined, _meta: {} }
      }
      switch (cmd.name) {
        case "compact":
          await this.config.sdk.session.summarize({
            sessionID, directory, providerID: model.providerID, modelID: model.modelID,
          }, { throwOnError: true })
          break
      }
      await sendUsageUpdate(this.connection, this.sdk, sessionID, directory)
      return { stopReason: "end_turn" as const, _meta: {} }
    }

    async cancel(params: CancelNotification) {
      const session = this.sessionManager.get(params.sessionId)
      if (!session) throw new Error(`ACP cancel: unknown session ${params.sessionId}`)
      await this.config.sdk.session.abort({
        sessionID: params.sessionId, directory: session.cwd,
      }, { throwOnError: true })
    }
  }
}
