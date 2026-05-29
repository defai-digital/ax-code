import * as vscode from "vscode"
import { createAxCodeClient, type AxCodeClient } from "@ax-code/sdk"
import { ServerError } from "./errors"
import { renderMarkdown } from "./markdown"
import type { AxCodeServer } from "./server-lifecycle"

export { ServerError }

const STATE_SESSION_ID = "axCode.sessionId"

export interface SelectedModel {
  providerID: string
  modelID: string
}

export interface SendMessageResult {
  finalText: string
  agent: string
  tokens: number
  html: string
}

/**
 * Streaming events emitted to the chat view. The provider translates these
 * into webview postMessages — keeping SessionClient ignorant of webview
 * protocol makes it independently testable.
 */
export interface SessionStreamEvents {
  onStreamText: (partId: string, text: string, html: string) => void
  onToolUpdate: (partId: string, tool: string, status: string) => void
  onAgentInfo: (agent: string, modelID: string) => void
}

const STREAM_FLUSH_INTERVAL_MS = 60

/**
 * Wraps a single conversation session against `ax-code serve` via @ax-code/sdk.
 * Owns:
 * - The session id (persisted in workspaceState so it survives reloads).
 * - The SSE event reader that drives streaming.
 * - Per-part flush throttling so high-frequency deltas don't pin the UI.
 *
 * The SDK client is built lazily after the server reports listening because we
 * need its URL for the baseUrl. Workspace folder is bound at first use; if the
 * user switches workspaces, VS Code reloads the extension host anyway.
 */
export class SessionClient {
  private sessionId: string | null = null
  private sessionValidated = false
  private client: AxCodeClient | null = null
  private streamController: AbortController | null = null
  private streamingParts = new Map<string, string>()
  private streamFlushTimers = new Map<string, NodeJS.Timeout>()
  private streamLastFlush = new Map<string, number>()

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly server: AxCodeServer,
    private readonly events: SessionStreamEvents,
  ) {
    this.sessionId = context.workspaceState.get<string>(STATE_SESSION_ID) ?? null
    server.setOnExit(() => {
      this.stopEventStream()
      this.client = null
      this.sessionValidated = false
    })
  }

  get currentSessionId(): string | null {
    return this.sessionId
  }

  async sendMessage(text: string, model: SelectedModel | null, signal: AbortSignal): Promise<SendMessageResult> {
    await this.ensureEventStream()
    await this.ensureSession(signal)
    const client = this.requireClient()

    const { data, error, response } = await client.session.prompt(
      {
        sessionID: this.sessionId!,
        parts: [{ type: "text", text }],
        ...(model ? { model } : {}),
      } as any,
      { signal },
    )

    if (error || !response.ok) {
      throw new ServerError(response.status, typeof error === "string" ? error : JSON.stringify(error ?? {}))
    }

    const result = data as any
    if (!result) {
      return { finalText: "", agent: "build", tokens: 0, html: "" }
    }
    const info = result?.info
    const parts = result?.parts ?? []
    const textPart = parts.findLast((p: any) => p.type === "text" && p.text)
    const finalText = textPart?.text ?? ""
    return {
      finalText,
      agent: info?.agent ?? "build",
      tokens: info?.tokens?.total ?? 0,
      html: renderMarkdown(finalText),
    }
  }

  async abort(): Promise<void> {
    if (!this.sessionId || !this.server.url) {
      return
    }
    const client = this.requireClient()
    try {
      await client.session.abort({ sessionID: this.sessionId })
    } catch {
      // Best effort — abort can race with server shutdown.
    }
  }

  async clearSession(): Promise<void> {
    await this.abort()
    this.stopEventStream()
    this.streamingParts.clear()
    this.sessionId = null
    this.sessionValidated = false
    await this.context.workspaceState.update(STATE_SESSION_ID, undefined)
  }

  async listProviders(): Promise<any> {
    const client = this.requireClient()
    const { data, error } = await client.provider.list()
    if (error) {
      throw new Error(`Failed to list providers: ${JSON.stringify(error)}`)
    }
    return data
  }

  dispose() {
    this.stopEventStream()
  }

  private requireClient(): AxCodeClient {
    if (!this.server.url) {
      throw new Error("Server not running")
    }
    if (!this.client) {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
      this.client = createAxCodeClient({
        baseUrl: this.server.url,
        directory: workspaceFolder,
      })
    }
    return this.client
  }

  private async ensureSession(signal: AbortSignal): Promise<void> {
    const client = this.requireClient()
    if (this.sessionId && !this.sessionValidated) {
      const { data, error } = await client.session.get({ sessionID: this.sessionId }, { signal })
      if (error || !data) {
        // Stale ID from a previous server instance — drop it.
        this.sessionId = null
        await this.context.workspaceState.update(STATE_SESSION_ID, undefined)
      } else {
        this.sessionValidated = true
      }
    }
    if (!this.sessionId) {
      const { data, error } = await client.session.create(undefined, { signal })
      if (error || !data) {
        throw new Error(`Failed to create session: ${JSON.stringify(error ?? {})}`)
      }
      this.sessionId = (data as any).id
      this.sessionValidated = true
      await this.context.workspaceState.update(STATE_SESSION_ID, this.sessionId)
    }
  }

  private async ensureEventStream(): Promise<void> {
    if (this.streamController || !this.server.url) {
      return
    }
    const client = this.requireClient()
    const controller = new AbortController()
    this.streamController = controller

    void (async () => {
      try {
        const result = await client.event.subscribe(undefined, { signal: controller.signal })
        for await (const event of result.stream) {
          this.handleBusEvent(event)
        }
      } catch {
        // aborted or network error — caller will retry on next turn
      } finally {
        if (this.streamController === controller) {
          this.streamController = null
        }
      }
    })()
  }

  private handleBusEvent(event: any) {
    if (!event || typeof event.type !== "string") {
      return
    }
    // Only emit events for our current session.
    const eventSession =
      event.properties?.sessionID ?? event.properties?.info?.sessionID ?? event.properties?.part?.sessionID
    if (eventSession && eventSession !== this.sessionId) {
      return
    }

    switch (event.type) {
      case "message.part.updated": {
        const part = event.properties?.part
        if (!part) {
          break
        }
        if (part.type === "text") {
          const text = part.text ?? ""
          this.streamingParts.set(part.id, text)
          // Full snapshots from `updated` always flush so the canonical text
          // isn't lost to throttling.
          this.flushStreamText(part.id, text)
        } else if (part.type === "tool") {
          this.events.onToolUpdate(part.id, part.tool, part.state?.status ?? "running")
        }
        break
      }
      case "message.part.delta": {
        const { partID, field, delta } = event.properties ?? {}
        if (!partID || field !== "text" || typeof delta !== "string") {
          break
        }
        const prev = this.streamingParts.get(partID) ?? ""
        const next = prev + delta
        this.streamingParts.set(partID, next)
        this.scheduleStreamFlush(partID)
        break
      }
      case "message.updated": {
        const info = event.properties?.info
        if (info?.role === "assistant" && info?.id && info.modelID) {
          this.events.onAgentInfo(info.agent ?? "build", `${info.providerID ?? ""}/${info.modelID}`)
        }
        break
      }
    }
  }

  private scheduleStreamFlush(partID: string) {
    if (this.streamFlushTimers.has(partID)) {
      return
    }
    const last = this.streamLastFlush.get(partID) ?? 0
    const elapsed = Date.now() - last
    const delay = elapsed >= STREAM_FLUSH_INTERVAL_MS ? 0 : STREAM_FLUSH_INTERVAL_MS - elapsed
    const timer = setTimeout(() => {
      this.streamFlushTimers.delete(partID)
      const text = this.streamingParts.get(partID)
      if (text === undefined) {
        return
      }
      this.flushStreamText(partID, text)
    }, delay)
    this.streamFlushTimers.set(partID, timer)
  }

  private flushStreamText(partID: string, text: string) {
    const timer = this.streamFlushTimers.get(partID)
    if (timer) {
      clearTimeout(timer)
      this.streamFlushTimers.delete(partID)
    }
    this.streamLastFlush.set(partID, Date.now())
    this.events.onStreamText(partID, text, renderMarkdown(text))
  }

  private stopEventStream() {
    if (this.streamController) {
      this.streamController.abort()
      this.streamController = null
    }
    for (const t of this.streamFlushTimers.values()) {
      clearTimeout(t)
    }
    this.streamFlushTimers.clear()
    this.streamLastFlush.clear()
  }

  /**
   * Trim the streaming-parts map to bound memory. Called after each turn from
   * the provider. Keeps the most recent ~64 entries so any late-arriving
   * deltas can still find their accumulator.
   */
  pruneStreamingParts() {
    if (this.streamingParts.size > 128) {
      const keys = Array.from(this.streamingParts.keys()).slice(0, this.streamingParts.size - 64)
      for (const k of keys) {
        this.streamingParts.delete(k)
      }
    }
  }
}
