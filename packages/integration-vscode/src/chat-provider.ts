/**
 * Chat View Provider
 *
 * Manages the sidebar webview panel for chatting with the ax-code agent.
 * Communicates with ax-code via HTTP server (ax-code serve).
 */

import * as vscode from "vscode"
import { spawn, type ChildProcess } from "node:child_process"

interface SessionInfo {
  id: string
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  private webviewView?: vscode.WebviewView
  private serverProcess: ChildProcess | null = null
  private selectedModel: { providerID: string; modelID: string } | null = null
  private serverUrl: string | null = null
  private sessionId: string | null = null
  private isProcessing = false

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    }

    webviewView.webview.html = this.getHtml()

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
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
      this.stopServer()
    })
  }

  async sendMessage(text: string) {
    if (this.webviewView) {
      this.webviewView.show(true)
      this.postMessage({ type: "userMessage", text })
      await this.handleUserMessage(text)
    }
  }

  private async handleUserMessage(text: string) {
    if (this.isProcessing) {
      vscode.window.showWarningMessage("ax-code is still processing...")
      return
    }

    this.isProcessing = true
    this.postMessage({ type: "status", status: "thinking" })

    try {
      if (!this.serverUrl) {
        this.postMessage({ type: "status", status: "initializing" })
        await this.startServer()
      }

      if (!this.sessionId) {
        const session = await this.apiCall<SessionInfo>("POST", "/session")
        this.sessionId = session.id
      }

      // Send prompt (blocking — waits for full response)
      // Use AbortController for 3 minute timeout
      this.postMessage({ type: "status", status: "thinking" })
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 180000) // 3 minutes

      try {
        const response = await fetch(`${this.serverUrl}/session/${this.sessionId}/message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-ax-code-directory": vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
          },
          body: JSON.stringify({
            parts: [{ type: "text", text }],
            ...(this.selectedModel ? { model: this.selectedModel } : {}),
          }),
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        const responseText = await response.text()
        if (!responseText) {
          this.postMessage({ type: "error", message: "Empty response from server" })
          return
        }

        const result = JSON.parse(responseText)
        const info = result?.info
        const parts = result?.parts ?? []
        const textPart = parts.findLast((p: any) => p.type === "text" && p.text)
        const toolParts = parts.filter((p: any) => p.type === "tool")
        const finalText = textPart?.text ?? ""
        const agent = info?.agent ?? "build"
        const tokens = info?.tokens?.total ?? 0

        for (const tool of toolParts) {
          this.postMessage({
            type: "toolResult",
            tool: tool.tool,
            status: tool.state?.status ?? "completed",
            output: "",
          })
        }

        this.postMessage({ type: "textChunk", text: finalText })
        this.postMessage({ type: "done", text: finalText, agent, tokens })
      } catch (e: any) {
        clearTimeout(timeoutId)
        if (e.name === "AbortError") {
          this.postMessage({ type: "error", message: "Request timed out (3 minutes). Try a simpler prompt." })
        } else {
          throw e
        }
      }
    } catch (error: any) {
      this.postMessage({ type: "error", message: error.message ?? "Unknown error" })
    } finally {
      this.isProcessing = false
      this.postMessage({ type: "status", status: "idle" })
    }
  }

  private async handleClear() {
    this.sessionId = null
    this.postMessage({ type: "cleared" })
  }

  private async handleStop() {
    if (this.sessionId && this.serverUrl) {
      try {
        await this.apiCall("POST", `/session/${this.sessionId}/abort`)
      } catch {}
    }
    this.isProcessing = false
    this.postMessage({ type: "status", status: "idle" })
  }

  private async handleSelectModel() {
    try {
      if (!this.serverUrl) {
        this.postMessage({ type: "status", status: "initializing" })
        await this.startServer()
        this.postMessage({ type: "status", status: "idle" })
      }

      // Get available providers and models from server
      const config = await this.apiCall<any>("GET", "/config/providers")
      const providers = config?.providers ?? []

      const items: vscode.QuickPickItem[] = []
      for (const provider of providers) {
        if (!provider.models) continue
        for (const [modelID, model] of Object.entries(provider.models as Record<string, any>)) {
          items.push({
            label: `${provider.id}/${modelID}`,
            description: provider.name ?? provider.id,
          })
        }
      }

      if (items.length === 0) {
        vscode.window.showWarningMessage("No models available. Add a provider first: ax-code providers login")
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
        this.postMessage({ type: "modelSelected", model: selected.label })
        vscode.window.showInformationMessage(`Model: ${selected.label}`)
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to load models: ${error.message}`)
    }
  }

  private async startServer(): Promise<void> {
    const port = Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()

    // Find ax-code entry point — try multiple approaches
    const axCodePath = this.findAxCodePath()

    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        AX_CODE_CALLER: "vscode",
        AX_CODE_ORIGINAL_CWD: workspaceFolder,
      }

      const proc = axCodePath.useBun
        ? spawn(
            "bun",
            [
              "run",
              "--cwd",
              axCodePath.cwd,
              "--conditions=browser",
              axCodePath.entry,
              "serve",
              `--hostname=127.0.0.1`,
              `--port=${port}`,
            ],
            {
              cwd: workspaceFolder,
              env,
              shell: true,
            },
          )
        : spawn(axCodePath.command, ["serve", `--hostname=127.0.0.1`, `--port=${port}`], {
            cwd: workspaceFolder,
            env,
            shell: true,
          })

      this.serverProcess = proc

      const timeout = setTimeout(() => {
        reject(new Error("Server start timeout (90s). Try again — first launch is slow due to TypeScript compilation."))
      }, 90000)

      let output = ""
      proc.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString()
        const match = output.match(/listening on\s+(https?:\/\/[^\s]+)/)
        if (match) {
          clearTimeout(timeout)
          this.serverUrl = match[1]
          resolve()
        }
      })

      proc.stderr?.on("data", (chunk: Buffer) => {
        output += chunk.toString()
      })

      proc.on("error", (error) => {
        clearTimeout(timeout)
        reject(new Error(`Failed to start ax-code: ${error.message}`))
      })

      proc.on("exit", (code) => {
        clearTimeout(timeout)
        if (!this.serverUrl) {
          reject(new Error(`ax-code exited with code ${code}`))
        }
        this.serverProcess = null
        this.serverUrl = null
      })
    })
  }

  private findAxCodePath(): { useBun: boolean; command: string; cwd: string; entry: string } {
    const path = require("path")
    const fs = require("fs")

    // Try 1: Extension is inside packages/integration-vscode in monorepo (dev mode)
    const extensionDir = this.context.extensionPath
    const monorepoRoot = path.resolve(extensionDir, "..", "..")
    const axCodeEntry = path.join(monorepoRoot, "packages", "ax-code", "src", "index.ts")
    const axCodeCwd = path.join(monorepoRoot, "packages", "ax-code")

    if (fs.existsSync(axCodeEntry)) {
      return { useBun: true, command: "bun", cwd: axCodeCwd, entry: axCodeEntry }
    }

    // Try 2: Known install location (from setup:cli)
    const knownEntry = "C:\\ax-code\\ax-code\\packages\\ax-code\\src\\index.ts"
    const knownCwd = "C:\\ax-code\\ax-code\\packages\\ax-code"
    if (fs.existsSync(knownEntry)) {
      return { useBun: true, command: "bun", cwd: knownCwd, entry: knownEntry }
    }

    // Try 3: ax-code command globally
    return { useBun: false, command: "ax-code", cwd: "", entry: "" }
  }

  private stopServer() {
    if (this.serverProcess) {
      this.serverProcess.kill()
      this.serverProcess = null
      this.serverUrl = null
    }
  }

  private async apiCall<T>(method: string, path: string, body?: any): Promise<T> {
    if (!this.serverUrl) throw new Error("Server not running")

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()

    const headers: Record<string, string> = {
      "x-ax-code-directory": workspaceFolder,
    }
    let requestBody: string | undefined
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      headers["Content-Type"] = "application/json"
      requestBody = JSON.stringify(body ?? {})
    }

    const response = await fetch(`${this.serverUrl}${path}`, {
      method,
      headers,
      body: requestBody,
    })

    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new Error(`API error ${response.status}: ${text.slice(0, 200)}`)
    }

    const text = await response.text()
    if (!text) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      return undefined as T
    }
  }

  private postMessage(message: any) {
    this.webviewView?.webview.postMessage(message)
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }
    .message {
      margin-bottom: 12px;
      padding: 8px 12px;
      border-radius: 6px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .message.user {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
    }
    .message.assistant {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border, transparent);
    }
    .message.error {
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder, red);
      color: var(--vscode-errorForeground);
    }
    .tool-call {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      padding: 4px 8px;
      margin: 4px 0;
      border-left: 2px solid var(--vscode-activityBarBadge-background);
    }
    .tool-call .tool-name { font-weight: bold; }
    .tool-call.completed { border-left-color: var(--vscode-testing-iconPassed); }
    .tool-call.error { border-left-color: var(--vscode-testing-iconFailed); }
    .agent-badge {
      display: inline-block;
      font-size: 0.75em;
      padding: 1px 6px;
      border-radius: 3px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      margin-bottom: 4px;
    }
    .tokens {
      font-size: 0.75em;
      color: var(--vscode-descriptionForeground);
      text-align: right;
      margin-top: 4px;
    }
    .status {
      text-align: center;
      padding: 8px;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    #input-area {
      padding: 8px;
      border-top: 1px solid var(--vscode-widget-border, transparent);
      display: flex;
      gap: 4px;
    }
    #input {
      flex: 1;
      padding: 6px 10px;
      border: 1px solid var(--vscode-input-border, transparent);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 4px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      resize: none;
      min-height: 36px;
      max-height: 120px;
    }
    #input:focus { outline: 1px solid var(--vscode-focusBorder); }
    button {
      padding: 6px 12px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: var(--vscode-font-size);
    }
    #send-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    #send-btn:hover { background: var(--vscode-button-hoverBackground); }
    #send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .actions {
      display: flex;
      gap: 4px;
      padding: 4px 8px;
    }
    .action-btn {
      font-size: 0.8em;
      padding: 2px 8px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      border-radius: 3px;
      cursor: pointer;
    }
    .action-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
  </style>
</head>
<body>
  <div class="actions">
    <button class="action-btn" onclick="selectModel()">Model</button>
    <button class="action-btn" onclick="clearChat()">Clear</button>
    <button class="action-btn" onclick="stopAgent()">Stop</button>
    <span id="model-label" style="font-size:0.75em;color:var(--vscode-descriptionForeground);margin-left:auto;padding:2px 4px;"></span>
  </div>
  <div id="messages">
    <div class="status">Type a message to start chatting with ax-code</div>
  </div>
  <div id="input-area">
    <textarea id="input" rows="1" placeholder="Ask ax-code..."
      onkeydown="handleKeyDown(event)"></textarea>
    <button id="send-btn" onclick="send()">Send</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send-btn');
    let currentAssistantEl = null;
    let currentText = '';
    let isProcessing = false;

    function send() {
      const text = inputEl.value.trim();
      if (!text || isProcessing) return;
      addMessage('user', text);
      inputEl.value = '';
      inputEl.style.height = '36px';
      vscode.postMessage({ type: 'send', text });
    }

    function handleKeyDown(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
      setTimeout(() => {
        inputEl.style.height = '36px';
        inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
      }, 0);
    }

    function clearChat() {
      messagesEl.innerHTML = '<div class="status">Chat cleared</div>';
      currentAssistantEl = null;
      currentText = '';
      vscode.postMessage({ type: 'clear' });
    }

    function stopAgent() { vscode.postMessage({ type: 'stop' }); }
    function selectModel() { vscode.postMessage({ type: 'selectModel' }); }

    function addMessage(role, text) {
      const div = document.createElement('div');
      div.className = 'message ' + role;
      div.textContent = text;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return div;
    }

    function ensureAssistant() {
      if (!currentAssistantEl) {
        currentAssistantEl = document.createElement('div');
        currentAssistantEl.className = 'message assistant';
        currentText = '';
        messagesEl.appendChild(currentAssistantEl);
      }
      return currentAssistantEl;
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'userMessage': addMessage('user', msg.text); break;
        case 'status':
          if (msg.status === 'thinking' || msg.status === 'initializing') {
            isProcessing = true; sendBtn.disabled = true;
            const label = msg.status === 'initializing' ? 'Starting ax-code...' : 'Thinking...';
            const s = document.createElement('div'); s.className = 'status'; s.textContent = label;
            messagesEl.appendChild(s); messagesEl.scrollTop = messagesEl.scrollHeight;
          } else if (msg.status === 'idle') {
            isProcessing = false; sendBtn.disabled = false; currentAssistantEl = null;
            messagesEl.querySelectorAll('.status').forEach(s => {
              if (s.textContent.includes('Thinking') || s.textContent.includes('Starting')) s.remove();
            });
          }
          break;
        case 'textChunk':
          const el = ensureAssistant();
          currentText += msg.text; el.textContent = currentText;
          messagesEl.scrollTop = messagesEl.scrollHeight;
          break;
        case 'toolCall': {
          const tc = document.createElement('div'); tc.className = 'tool-call';
          const tcSpan = document.createElement('span'); tcSpan.className = 'tool-name'; tcSpan.textContent = msg.tool;
          tc.appendChild(tcSpan);
          messagesEl.appendChild(tc); messagesEl.scrollTop = messagesEl.scrollHeight;
          break;
        }
        case 'toolResult': {
          const tr = document.createElement('div'); tr.className = 'tool-call ' + msg.status;
          const trSpan = document.createElement('span'); trSpan.className = 'tool-name'; trSpan.textContent = msg.tool;
          tr.appendChild(trSpan);
          tr.appendChild(document.createTextNode(' ' + msg.status));
          messagesEl.appendChild(tr); messagesEl.scrollTop = messagesEl.scrollHeight;
          break;
        }
        case 'done':
          if (msg.text && currentAssistantEl) currentAssistantEl.textContent = msg.text;
          if (currentAssistantEl) {
            const badge = document.createElement('div');
            const agentSpan = document.createElement('span'); agentSpan.className = 'agent-badge'; agentSpan.textContent = msg.agent || 'build';
            badge.appendChild(agentSpan);
            currentAssistantEl.prepend(badge);
            if (msg.tokens > 0) {
              const tok = document.createElement('div'); tok.className = 'tokens';
              tok.textContent = msg.tokens.toLocaleString() + ' tokens';
              currentAssistantEl.appendChild(tok);
            }
          }
          currentAssistantEl = null;
          break;
        case 'error': addMessage('error', msg.message); break;
        case 'cleared': currentAssistantEl = null; currentText = ''; break;
        case 'modelSelected':
          document.getElementById('model-label').textContent = msg.model;
          break;
        case 'agentInfo':
          document.getElementById('model-label').textContent = (msg.modelID || '') + ' (' + (msg.agent || 'build') + ')';
          break;
      }
    });
    inputEl.focus();
  </script>
</body>
</html>`
  }
}
