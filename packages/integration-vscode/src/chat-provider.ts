/**
 * Chat View Provider
 *
 * Thin sidebar webview that routes user input ↔ SessionClient ↔ rendered HTML.
 * Server lifecycle (AxCodeServer) and protocol/streaming state (SessionClient)
 * live in their own modules.
 */

import * as vscode from "vscode"
import { getConfig } from "./config"
import { renderMarkdown } from "./markdown"
import { AxCodeServer } from "./server-lifecycle"
import { SelectedModel, SessionClient, ServerError } from "./session-client"
import { buildChatHtml, generateNonce } from "./webview-html"
import { providerModelPickItems } from "./provider-picker"

const STATE_SELECTED_MODEL = "axCode.selectedModel"

type CancelReason = "user-cancel-stop" | "user-cancel-clear" | null

export class ChatViewProvider implements vscode.WebviewViewProvider {
  private webviewView?: vscode.WebviewView
  private readonly server: AxCodeServer
  private readonly session: SessionClient
  private selectedModel: SelectedModel | null = null
  private isProcessing = false
  private activeController: AbortController | null = null
  private activeCancelReason: CancelReason = null

  constructor(private readonly context: vscode.ExtensionContext) {
    const storedModel = context.workspaceState.get<SelectedModel>(STATE_SELECTED_MODEL)
    if (storedModel) {
      this.selectedModel = storedModel
    } else {
      const fallback = getConfig().defaultModel
      if (fallback.includes("/")) {
        const [providerID, ...rest] = fallback.split("/")
        this.selectedModel = { providerID, modelID: rest.join("/") }
      }
    }

    this.server = new AxCodeServer(context)
    this.session = new SessionClient(context, this.server, {
      onStreamText: (partId, _text, html) => {
        this.postMessage({ type: "streamText", partId, html })
      },
      onToolUpdate: (partId, tool, status) => {
        this.postMessage({ type: "toolUpdate", partId, tool, status })
      },
      onAgentInfo: (agent, modelID) => {
        this.postMessage({ type: "agentInfo", agent, modelID })
      },
    })
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    }

    webviewView.webview.html = buildChatHtml(generateNonce(), webviewView.webview.cspSource)

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "ready":
          this.postInitialState()
          break
        case "send":
          await this.handleUserMessage(message.text)
          break
        case "clear":
          await this.handleClear()
          break
        case "stop":
          await this.handleStop()
          break
        case "selectModel":
          await this.handleSelectModel()
          break
      }
    })

    webviewView.onDidDispose(() => {
      this.session.dispose()
      this.server.dispose()
    })
  }

  async sendMessage(text: string) {
    if (!this.webviewView) {
      await vscode.commands.executeCommand("ax-code.chatView.focus")
      const start = Date.now()
      while (!this.webviewView && Date.now() - start < 3000) {
        await new Promise((r) => setTimeout(r, 50))
      }
      if (!this.webviewView) {
        vscode.window.showErrorMessage("ax-code chat view failed to open")
        return
      }
    }
    this.webviewView.show(true)
    this.postMessage({ type: "userMessage", text })
    await this.handleUserMessage(text)
  }

  dispose() {
    this.session.dispose()
    this.server.dispose()
  }

  private postInitialState() {
    if (this.selectedModel) {
      this.postMessage({
        type: "modelSelected",
        model: `${this.selectedModel.providerID}/${this.selectedModel.modelID}`,
      })
    }
  }

  private async handleUserMessage(text: string) {
    if (this.isProcessing) {
      vscode.window.showWarningMessage("ax-code is still processing...")
      return
    }

    this.isProcessing = true
    this.activeCancelReason = null
    this.postMessage({ type: "status", status: "thinking" })

    try {
      if (!this.server.url) {
        this.postMessage({ type: "status", status: "initializing" })
        await this.server.ensureStarted()
      }

      const controller = new AbortController()
      this.activeController = controller

      const { requestTimeoutMs } = getConfig()
      const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs)

      try {
        const result = await this.session.sendMessage(text, this.selectedModel, controller.signal)
        clearTimeout(timeoutId)
        this.postMessage({
          type: "done",
          text: result.finalText,
          agent: result.agent,
          tokens: result.tokens,
          html: result.html,
        })
      } catch (e: any) {
        clearTimeout(timeoutId)
        if (e instanceof ServerError) {
          this.postMessage({ type: "error", message: e.message })
          return
        }
        if (e.name === "AbortError") {
          this.handleAbortError()
          return
        }
        throw e
      }
    } catch (error: any) {
      // AbortError here means cancel hit us before the message POST started
      // (e.g. during ensureSession). Route through the same cancel-reason path
      // instead of surfacing "Unknown error".
      if (error?.name === "AbortError") {
        this.handleAbortError()
      } else {
        this.postMessage({ type: "error", message: error?.message ?? "Unknown error" })
      }
    } finally {
      this.activeController = null
      this.activeCancelReason = null
      this.isProcessing = false
      this.session.pruneStreamingParts()
      this.postMessage({ type: "status", status: "idle" })
    }
  }

  private handleAbortError() {
    if (this.activeCancelReason === "user-cancel-clear") {
      // Webview already showed the 'Chat cleared' status; suppress duplicate error.
      return
    }
    if (this.activeCancelReason === "user-cancel-stop") {
      this.postMessage({ type: "error", message: "Cancelled" })
      return
    }
    this.postMessage({ type: "error", message: "Request timed out." })
  }

  private async handleClear() {
    this.activeCancelReason = "user-cancel-clear"
    this.activeController?.abort("user-cancel-clear")
    await this.session.clearSession()
    this.postMessage({ type: "cleared" })
  }

  private async handleStop() {
    this.activeCancelReason = "user-cancel-stop"
    this.activeController?.abort("user-cancel-stop")
    await this.session.abort()
  }

  private async handleSelectModel() {
    try {
      if (!this.server.url) {
        this.postMessage({ type: "status", status: "initializing" })
        await this.server.ensureStarted()
        this.postMessage({ type: "status", status: "idle" })
      }

      const config = await this.session.listProviders()
      const items: vscode.QuickPickItem[] = providerModelPickItems(config)

      if (items.length === 0) {
        vscode.window.showWarningMessage("No models available. Run: ax-code providers login")
        return
      }

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: this.selectedModel
          ? `Current: ${this.selectedModel.providerID}/${this.selectedModel.modelID}`
          : "Select a model",
        matchOnDescription: true,
      })

      if (selected) {
        const [providerID, ...modelParts] = selected.label.split("/")
        const modelID = modelParts.join("/")
        this.selectedModel = { providerID, modelID }
        await this.context.workspaceState.update(STATE_SELECTED_MODEL, this.selectedModel)
        this.postMessage({ type: "modelSelected", model: selected.label })
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to load models: ${error.message}`)
    }
  }

  private postMessage(message: any) {
    this.webviewView?.webview.postMessage(message)
  }
}

// Re-export the markdown helper for any future webview-side renders.
export { renderMarkdown }
