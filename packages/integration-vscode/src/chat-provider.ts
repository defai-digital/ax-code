/**
 * Chat View Provider
 *
 * Sidebar chat panel for ax-code. Streams assistant output via SSE and
 * renders markdown with syntax-highlighted code blocks.
 */

import * as vscode from "vscode";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { marked } from "marked";

const STATE_SESSION_ID = "axCode.sessionId";
const STATE_SELECTED_MODEL = "axCode.selectedModel";

interface SessionInfo {
  id: string
}

interface SelectedModel {
  providerID: string
  modelID: string
}

interface EventStreamHandle {
  close: () => void
  done: Promise<void>
}

function enrichPath(existing: string): string {
  if (process.platform === "win32") {return existing;}
  const home = os.homedir();
  const extras = [
    path.join(home, ".bun", "bin"),
    path.join(home, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
  const parts = existing ? existing.split(":") : [];
  for (const p of extras) {
    if (!parts.includes(p)) {parts.push(p);}
  }
  return parts.join(":");
}

function getConfig() {
  const cfg = vscode.workspace.getConfiguration("axCode");
  return {
    binaryPath: cfg.get<string>("binaryPath", "").trim(),
    serverTimeoutMs: cfg.get<number>("serverTimeoutMs", 90000),
    requestTimeoutMs: cfg.get<number>("requestTimeoutMs", 600000),
    defaultModel: cfg.get<string>("defaultModel", "").trim(),
  };
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  private webviewView?: vscode.WebviewView;
  private serverProcess: ChildProcess | null = null;
  private selectedModel: SelectedModel | null = null;
  private serverUrl: string | null = null;
  private sessionId: string | null = null;
  private isProcessing = false;
  private startServerPromise: Promise<void> | null = null;
  private activeController: AbortController | null = null;
  private activeCancelReason: "user-cancel-stop" | "user-cancel-clear" | null = null;
  private eventStream: EventStreamHandle | null = null;
  private currentAssistantMessageId: string | null = null;
  // Tracks streaming text accumulated from message.part.delta per part id.
  // Entries expire lazily — we keep the last ~64 to bound memory without
  // racing finally/teardown against trailing deltas.
  private streamingParts = new Map<string, string>();
  // Throttle state: pending render for a part, last-flushed timestamp.
  private streamFlushTimers = new Map<string, NodeJS.Timeout>();
  private streamLastFlush = new Map<string, number>();
  private readonly STREAM_FLUSH_INTERVAL_MS = 60;
  private sessionValidated = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    const storedModel = context.workspaceState.get<SelectedModel>(STATE_SELECTED_MODEL);
    if (storedModel) {
      this.selectedModel = storedModel;
    } else {
      const fallback = getConfig().defaultModel;
      if (fallback.includes("/")) {
        const [providerID, ...rest] = fallback.split("/");
        this.selectedModel = { providerID, modelID: rest.join("/") };
      }
    }
    this.sessionId = context.workspaceState.get<string>(STATE_SESSION_ID) ?? null;
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "ready":
          this.postInitialState();
          break;
        case "send":
          await this.handleUserMessage(message.text);
          break;
        case "clear":
          await this.handleClear();
          break;
        case "stop":
          await this.handleStop();
          break;
        case "selectModel":
          await this.handleSelectModel();
          break;
      }
    });

    webviewView.onDidDispose(() => {
      this.stopEventStream();
      this.stopServer();
    });
  }

  async sendMessage(text: string) {
    if (!this.webviewView) {
      await vscode.commands.executeCommand("ax-code.chatView.focus");
      const start = Date.now();
      while (!this.webviewView && Date.now() - start < 3000) {
        await new Promise((r) => setTimeout(r, 50));
      }
      if (!this.webviewView) {
        vscode.window.showErrorMessage("ax-code chat view failed to open");
        return;
      }
    }
    this.webviewView.show(true);
    this.postMessage({ type: "userMessage", text });
    await this.handleUserMessage(text);
  }

  private postInitialState() {
    if (this.selectedModel) {
      this.postMessage({
        type: "modelSelected",
        model: `${this.selectedModel.providerID}/${this.selectedModel.modelID}`,
      });
    }
  }

  private async handleUserMessage(text: string) {
    if (this.isProcessing) {
      vscode.window.showWarningMessage("ax-code is still processing...");
      return;
    }

    this.isProcessing = true;
    this.currentAssistantMessageId = null;
    this.activeCancelReason = null;
    this.postMessage({ type: "status", status: "thinking" });

    try {
      if (!this.serverUrl) {
        this.postMessage({ type: "status", status: "initializing" });
        await this.startServer();
      }

      await this.ensureEventStream();

      const controller = new AbortController();
      this.activeController = controller;

      await this.ensureSession(controller.signal);

      const { requestTimeoutMs } = getConfig();
      const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

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
        });

        clearTimeout(timeoutId);

        const responseText = await response.text();
        if (!response.ok) {
          this.postMessage({
            type: "error",
            message: `Server error ${response.status}: ${responseText.slice(0, 300) || response.statusText}`,
          });
          return;
        }

        // Streaming happens via SSE. The POST response arrives only once the
        // turn is finished; we use it for final agent/tokens metadata.
        if (!responseText) {
          this.postMessage({ type: "done", text: "", agent: "build", tokens: 0 });
          return;
        }

        let result: any;
        try {
          result = JSON.parse(responseText);
        } catch {
          this.postMessage({ type: "error", message: `Invalid JSON: ${responseText.slice(0, 200)}` });
          return;
        }
        const info = result?.info;
        const parts = result?.parts ?? [];
        const textPart = parts.findLast((p: any) => p.type === "text" && p.text);
        const finalText = textPart?.text ?? "";
        const agent = info?.agent ?? "build";
        const tokens = info?.tokens?.total ?? 0;
        this.postMessage({ type: "done", text: finalText, agent, tokens, html: this.renderMarkdown(finalText) });
      } catch (e: any) {
        clearTimeout(timeoutId);
        if (e.name === "AbortError") {
          if (this.activeCancelReason === "user-cancel-clear") {
            // Webview already showed the 'Chat cleared' status; suppress duplicate error.
          } else if (this.activeCancelReason === "user-cancel-stop") {
            this.postMessage({ type: "error", message: "Cancelled" });
          } else {
            this.postMessage({ type: "error", message: "Request timed out." });
          }
        } else {
          throw e;
        }
      }
    } catch (error: any) {
      // AbortError here means cancel hit us before the message POST started
      // (e.g. during ensureSession). Route through the same cancel-reason path
      // instead of surfacing "Unknown error".
      if (error?.name === "AbortError") {
        if (this.activeCancelReason === "user-cancel-clear") {
          // Suppressed — webview already rendered 'Chat cleared'.
        } else if (this.activeCancelReason === "user-cancel-stop") {
          this.postMessage({ type: "error", message: "Cancelled" });
        } else {
          this.postMessage({ type: "error", message: "Request timed out." });
        }
      } else {
        this.postMessage({ type: "error", message: error?.message ?? "Unknown error" });
      }
    } finally {
      this.activeController = null;
      this.activeCancelReason = null;
      this.isProcessing = false;
      this.currentAssistantMessageId = null;
      // Bound the streaming map rather than clearing — late deltas that arrive
      // after 'done' won't lose their accumulator mid-stream.
      if (this.streamingParts.size > 128) {
        const keys = Array.from(this.streamingParts.keys()).slice(0, this.streamingParts.size - 64);
        for (const k of keys) {this.streamingParts.delete(k);}
      }
      this.postMessage({ type: "status", status: "idle" });
    }
  }

  private async ensureSession(signal: AbortSignal): Promise<void> {
    if (this.sessionId && !this.sessionValidated) {
      try {
        await this.apiCall("GET", `/session/${this.sessionId}`, undefined, signal);
        this.sessionValidated = true;
      } catch {
        // Stale ID from a previous server instance — drop it.
        this.sessionId = null;
        await this.context.workspaceState.update(STATE_SESSION_ID, undefined);
      }
    }
    if (!this.sessionId) {
      const session = await this.apiCall<SessionInfo>("POST", "/session", undefined, signal);
      this.sessionId = session.id;
      this.sessionValidated = true;
      await this.context.workspaceState.update(STATE_SESSION_ID, this.sessionId);
    }
  }

  private async handleClear() {
    this.activeCancelReason = "user-cancel-clear";
    this.activeController?.abort("user-cancel-clear");
    if (this.sessionId && this.serverUrl) {
      try {
        await this.apiCall("POST", `/session/${this.sessionId}/abort`);
      } catch {}
    }
    this.sessionId = null;
    this.sessionValidated = false;
    await this.context.workspaceState.update(STATE_SESSION_ID, undefined);
    this.postMessage({ type: "cleared" });
  }

  private async handleStop() {
    this.activeCancelReason = "user-cancel-stop";
    this.activeController?.abort("user-cancel-stop");
    if (this.sessionId && this.serverUrl) {
      try {
        await this.apiCall("POST", `/session/${this.sessionId}/abort`);
      } catch {}
    }
  }

  private async handleSelectModel() {
    try {
      if (!this.serverUrl) {
        this.postMessage({ type: "status", status: "initializing" });
        await this.startServer();
        this.postMessage({ type: "status", status: "idle" });
      }

      const config = await this.apiCall<any>("GET", "/config/providers");
      const providers = config?.providers ?? [];

      const items: vscode.QuickPickItem[] = [];
      for (const provider of providers) {
        if (!provider.models) {continue;}
        for (const modelID of Object.keys(provider.models as Record<string, any>)) {
          items.push({
            label: `${provider.id}/${modelID}`,
            description: provider.name ?? provider.id,
          });
        }
      }

      if (items.length === 0) {
        vscode.window.showWarningMessage("No models available. Run: ax-code providers login");
        return;
      }

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: this.selectedModel
          ? `Current: ${this.selectedModel.providerID}/${this.selectedModel.modelID}`
          : "Select a model",
        matchOnDescription: true,
      });

      if (selected) {
        const [providerID, ...modelParts] = selected.label.split("/");
        const modelID = modelParts.join("/");
        this.selectedModel = { providerID, modelID };
        await this.context.workspaceState.update(STATE_SELECTED_MODEL, this.selectedModel);
        this.postMessage({ type: "modelSelected", model: selected.label });
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to load models: ${error.message}`);
    }
  }

  private async ensureEventStream(): Promise<void> {
    if (this.eventStream || !this.serverUrl) {return;}
    const controller = new AbortController();
    const url = `${this.serverUrl}/event`;
    const streamPromise = (async () => {
      try {
        const response = await fetch(url, {
          headers: { Accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {return;}
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) {break;}
          buffer += decoder.decode(value, { stream: true });
          let sep = buffer.indexOf("\n\n");
          while (sep !== -1) {
            const chunk = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            this.handleSseChunk(chunk);
            sep = buffer.indexOf("\n\n");
          }
        }
      } catch {
        // aborted or network error — caller will retry on next turn
      }
    })();

    this.eventStream = {
      close: () => controller.abort(),
      done: streamPromise,
    };
  }

  private handleSseChunk(chunk: string) {
    const lines = chunk.split("\n");
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("data:")) {dataLines.push(line.slice(5).trimStart());}
    }
    if (dataLines.length === 0) {return;}
    const payload = dataLines.join("\n");
    let event: any;
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }
    this.handleBusEvent(event);
  }

  private handleBusEvent(event: any) {
    if (!event || typeof event.type !== "string") {return;}
    // Only emit events for our current session.
    const eventSession =
      event.properties?.sessionID ?? event.properties?.info?.sessionID ?? event.properties?.part?.sessionID;
    if (eventSession && this.sessionId && eventSession !== this.sessionId) {return;}

    switch (event.type) {
      case "message.part.updated": {
        const part = event.properties?.part;
        if (!part) {break;}
        if (part.type === "text") {
          this.currentAssistantMessageId = part.messageID ?? this.currentAssistantMessageId;
          const text = part.text ?? "";
          this.streamingParts.set(part.id, text);
          // Full snapshots from `updated` always flush so the canonical text
          // isn't lost to throttling.
          this.flushStreamText(part.id, text);
        } else if (part.type === "tool") {
          this.postMessage({
            type: "toolUpdate",
            partId: part.id,
            tool: part.tool,
            status: part.state?.status ?? "running",
          });
        }
        break;
      }
      case "message.part.delta": {
        const { partID, field, delta } = event.properties ?? {};
        if (!partID || field !== "text" || typeof delta !== "string") {break;}
        const prev = this.streamingParts.get(partID) ?? "";
        const next = prev + delta;
        this.streamingParts.set(partID, next);
        this.scheduleStreamFlush(partID);
        break;
      }
      case "message.updated": {
        const info = event.properties?.info;
        if (info?.role === "assistant" && info?.id) {
          this.currentAssistantMessageId = info.id;
          if (info.modelID) {
            this.postMessage({
              type: "agentInfo",
              agent: info.agent ?? "build",
              modelID: `${info.providerID ?? ""}/${info.modelID}`,
            });
          }
        }
        break;
      }
    }
  }

  private scheduleStreamFlush(partID: string) {
    if (this.streamFlushTimers.has(partID)) {return;}
    const last = this.streamLastFlush.get(partID) ?? 0;
    const elapsed = Date.now() - last;
    const delay = elapsed >= this.STREAM_FLUSH_INTERVAL_MS ? 0 : this.STREAM_FLUSH_INTERVAL_MS - elapsed;
    const timer = setTimeout(() => {
      this.streamFlushTimers.delete(partID);
      const text = this.streamingParts.get(partID);
      if (text === undefined) {return;}
      this.flushStreamText(partID, text);
    }, delay);
    this.streamFlushTimers.set(partID, timer);
  }

  private flushStreamText(partID: string, text: string) {
    const timer = this.streamFlushTimers.get(partID);
    if (timer) {
      clearTimeout(timer);
      this.streamFlushTimers.delete(partID);
    }
    this.streamLastFlush.set(partID, Date.now());
    this.postMessage({
      type: "streamText",
      partId: partID,
      text,
      html: this.renderMarkdown(text),
    });
  }

  private stopEventStream() {
    if (this.eventStream) {
      this.eventStream.close();
      this.eventStream = null;
    }
    for (const t of this.streamFlushTimers.values()) {clearTimeout(t);}
    this.streamFlushTimers.clear();
    this.streamLastFlush.clear();
  }

  private renderMarkdown(text: string): string {
    if (!text) {return "";}
    try {
      const html = marked.parse(text, { async: false, breaks: true, gfm: true }) as string;
      return sanitizeHtml(html);
    } catch {
      return escapeHtml(text);
    }
  }

  private async startServer(): Promise<void> {
    if (this.startServerPromise) {return this.startServerPromise;}
    this.startServerPromise = this.startServerWithRetry().finally(() => {
      this.startServerPromise = null;
    });
    return this.startServerPromise;
  }

  private async startServerWithRetry(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.startServerInner();
        return;
      } catch (err: any) {
        lastError = err;
        const msg = String(err?.message ?? "");
        const isPortBusy = /EADDRINUSE|address already in use|port.*in use|listen.*EACCES/i.test(msg);
        if (!isPortBusy) {throw err;}
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Failed to start ax-code after 3 attempts");
  }

  private async startServerInner(): Promise<void> {
    const port = Math.floor(Math.random() * (49150 - 16384 + 1)) + 16384;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    const axCodePath = this.findAxCodePath();
    const useShell = process.platform === "win32" && !axCodePath.useBun;
    const { serverTimeoutMs } = getConfig();

    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        PATH: enrichPath(process.env.PATH ?? ""),
        AX_CODE_CALLER: "vscode",
        AX_CODE_ORIGINAL_CWD: workspaceFolder,
      };

      const proc = axCodePath.useBun
        ? spawn(
            "bun",
            [
              `--cwd=${axCodePath.cwd}`,
              "run",
              "--conditions=browser",
              axCodePath.entry,
              "serve",
              `--hostname=127.0.0.1`,
              `--port=${port}`,
            ],
            { cwd: workspaceFolder, env, shell: false },
          )
        : spawn(axCodePath.command, ["serve", `--hostname=127.0.0.1`, `--port=${port}`], {
            cwd: workspaceFolder,
            env,
            shell: useShell,
          });

      this.serverProcess = proc;

      let settled = false;
      const settleReject = (err: Error) => {
        if (settled) {return;}
        settled = true;
        clearTimeout(timeout);
        try {
          proc.kill();
        } catch {}
        if (this.serverProcess === proc) {
          this.serverProcess = null;
          this.serverUrl = null;
        }
        reject(err);
      };
      const settleResolve = (url: string) => {
        if (settled) {return;}
        settled = true;
        clearTimeout(timeout);
        this.serverUrl = url;
        resolve();
      };

      const timeout = setTimeout(() => {
        settleReject(
          new Error(
            `ax-code serve did not report listening within ${Math.round(serverTimeoutMs / 1000)}s. First launch compiles TypeScript — retry or increase axCode.serverTimeoutMs.`,
          ),
        );
      }, serverTimeoutMs);

      // Only accumulate output until we've matched "listening" (or settled
      // with an error). After that, discard to avoid an unbounded leak over
      // the server's lifetime.
      let output = "";
      const appendUntilSettled = (chunk: Buffer) => {
        if (settled) {return;}
        output += chunk.toString();
        if (output.length > 8192) {output = output.slice(-8192);}
        const match = output.match(/listening on\s+(https?:\/\/[^\s]+)/);
        if (match) {settleResolve(match[1]);}
      };
      proc.stdout?.on("data", appendUntilSettled);
      proc.stderr?.on("data", appendUntilSettled);

      proc.on("error", (error) => {
        settleReject(new Error(`Failed to start ax-code: ${error.message}`));
      });

      proc.on("exit", (code) => {
        if (!settled) {
          const tail = output.slice(-800).trim();
          const detail = tail ? `\n${tail}` : "";
          settleReject(new Error(`ax-code exited with code ${code}${detail}`));
          return;
        }
        if (this.serverProcess === proc) {
          this.serverProcess = null;
          this.serverUrl = null;
        }
        this.stopEventStream();
      });
    });
  }

  private findAxCodePath(): { useBun: boolean; command: string; cwd: string; entry: string } {
    // Highest priority: explicit user config.
    const override = getConfig().binaryPath;
    if (override && fs.existsSync(override)) {
      return { useBun: false, command: override, cwd: "", entry: "" };
    }

    // Dev mode: extension is inside the monorepo next to packages/ax-code.
    // Require both the ax-code entry AND a repo-root signal (pnpm-workspace.yaml)
    // so an installed VSIX at ~/.vscode/extensions/... with unrelated sibling dirs
    // isn't misdetected as a monorepo checkout.
    const extensionDir = this.context.extensionPath;
    const monorepoRoot = path.resolve(extensionDir, "..", "..");
    const axCodeEntry = path.join(monorepoRoot, "packages", "ax-code", "src", "index.ts");
    const axCodeCwd = path.join(monorepoRoot, "packages", "ax-code");
    const workspaceMarker = path.join(monorepoRoot, "pnpm-workspace.yaml");
    if (fs.existsSync(axCodeEntry) && fs.existsSync(workspaceMarker)) {
      return { useBun: true, command: "bun", cwd: axCodeCwd, entry: axCodeEntry };
    }

    // Fall back to globally-installed ax-code command.
    return { useBun: false, command: "ax-code", cwd: "", entry: "" };
  }

  dispose() {
    this.stopEventStream();
    this.stopServer();
  }

  private stopServer() {
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
      this.serverUrl = null;
    }
  }

  private async apiCall<T>(method: string, apiPath: string, body?: any, signal?: AbortSignal): Promise<T> {
    if (!this.serverUrl) {throw new Error("Server not running");}

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const headers: Record<string, string> = { "x-ax-code-directory": workspaceFolder };
    let requestBody: string | undefined;
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      headers["Content-Type"] = "application/json";
      requestBody = JSON.stringify(body ?? {});
    }

    const response = await fetch(`${this.serverUrl}${apiPath}`, { method, headers, body: requestBody, signal });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`API error ${response.status}: ${text.slice(0, 200)}`);
    }
    const text = await response.text();
    if (!text) {throw new Error(`Empty response body from ${method} ${apiPath}`);}
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Invalid JSON response from ${method} ${apiPath}: ${text.slice(0, 200)}`);
    }
  }

  private postMessage(message: any) {
    this.webviewView?.webview.postMessage(message);
  }

  private getHtml(): string {
    const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
    const cspSource = this.webviewView?.webview.cspSource ?? "vscode-webview:";
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${cspSource};">
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
    #messages { flex: 1; overflow-y: auto; padding: 8px; }
    .message {
      margin-bottom: 12px;
      padding: 8px 12px;
      border-radius: 6px;
      line-height: 1.5;
      word-wrap: break-word;
    }
    .message.user {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      white-space: pre-wrap;
    }
    .message.assistant {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border, transparent);
    }
    .message.error {
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder, red);
      color: var(--vscode-errorForeground);
      white-space: pre-wrap;
    }
    .md > *:first-child { margin-top: 0; }
    .md > *:last-child { margin-bottom: 0; }
    .md p { margin: 0.5em 0; }
    .md ul, .md ol { margin: 0.5em 0 0.5em 1.5em; }
    .md pre {
      background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.1));
      border-radius: 4px;
      padding: 8px 10px;
      overflow-x: auto;
      margin: 0.5em 0;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.92em;
    }
    .md code {
      background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.1));
      padding: 1px 4px;
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.92em;
    }
    .md pre code { background: transparent; padding: 0; }
    .md h1, .md h2, .md h3 { margin: 0.5em 0 0.3em; }
    .md a { color: var(--vscode-textLink-foreground); }
    .md blockquote {
      border-left: 3px solid var(--vscode-textBlockQuote-border, var(--vscode-widget-border, #888));
      padding-left: 8px;
      color: var(--vscode-descriptionForeground);
      margin: 0.5em 0;
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
      align-items: center;
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
    #model-label {
      font-size: 0.75em;
      color: var(--vscode-descriptionForeground);
      margin-left: auto;
      padding: 2px 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 50%;
    }
  </style>
</head>
<body>
  <div class="actions">
    <button class="action-btn" id="btn-model">Model</button>
    <button class="action-btn" id="btn-clear">Clear</button>
    <button class="action-btn" id="btn-stop">Stop</button>
    <span id="model-label"></span>
  </div>
  <div id="messages">
    <div class="status">Type a message to start chatting with ax-code</div>
  </div>
  <div id="input-area">
    <textarea id="input" rows="1" placeholder="Ask ax-code..."></textarea>
    <button id="send-btn">Send</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send-btn');
    // partId -> DOM element for the streaming assistant text bubble.
    const streamEls = new Map();
    let activeAssistantEl = null;
    let toolEls = new Map();
    let isProcessing = false;

    function send() {
      const text = inputEl.value.trim();
      if (!text || isProcessing) return;
      inputEl.value = '';
      inputEl.style.height = '36px';
      vscode.postMessage({ type: 'send', text });
      // Local echo happens via 'userMessage' reply from provider to avoid duplicates.
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
      streamEls.clear();
      toolEls.clear();
      activeAssistantEl = null;
      vscode.postMessage({ type: 'clear' });
    }

    function stopAgent() { vscode.postMessage({ type: 'stop' }); }
    function selectModel() { vscode.postMessage({ type: 'selectModel' }); }

    document.getElementById('btn-model').addEventListener('click', selectModel);
    document.getElementById('btn-clear').addEventListener('click', clearChat);
    document.getElementById('btn-stop').addEventListener('click', stopAgent);
    document.getElementById('send-btn').addEventListener('click', send);
    inputEl.addEventListener('keydown', handleKeyDown);

    function addMessage(role, text) {
      const wasPinned = isPinnedToBottom();
      const div = document.createElement('div');
      div.className = 'message ' + role;
      div.textContent = text;
      messagesEl.appendChild(div);
      // User-sent messages always scroll; assistant/error only if already pinned.
      scrollToBottom(role === 'user' || wasPinned);
      return div;
    }

    function isPinnedToBottom() {
      const slack = 40;
      return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < slack;
    }
    function scrollToBottom(force) {
      if (force || isPinnedToBottom()) {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    }

    function getOrCreateStreamEl(partId) {
      let el = streamEls.get(partId);
      if (!el) {
        el = document.createElement('div');
        el.className = 'message assistant md';
        messagesEl.appendChild(el);
        streamEls.set(partId, el);
        activeAssistantEl = el;
      }
      return el;
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'userMessage':
          addMessage('user', msg.text);
          break;
        case 'status':
          if (msg.status === 'thinking' || msg.status === 'initializing') {
            isProcessing = true; sendBtn.disabled = true;
            const label = msg.status === 'initializing' ? 'Starting ax-code...' : 'Thinking...';
            let live = messagesEl.querySelector('.status[data-live="1"]');
            if (!live) {
              live = document.createElement('div');
              live.className = 'status';
              live.setAttribute('data-live', '1');
              messagesEl.appendChild(live);
            }
            live.textContent = label;
            scrollToBottom(false);
          } else if (msg.status === 'idle') {
            isProcessing = false; sendBtn.disabled = false;
            messagesEl.querySelectorAll('.status[data-live="1"]').forEach(s => s.remove());
            streamEls.clear();
            toolEls.clear();
          }
          break;
        case 'streamText': {
          // First stream chunk — remove the live 'Thinking...' placeholder.
          messagesEl.querySelectorAll('.status[data-live="1"]').forEach(s => s.remove());
          const el = getOrCreateStreamEl(msg.partId);
          el.innerHTML = msg.html || '';
          scrollToBottom(false);
          break;
        }
        case 'toolUpdate': {
          let el = toolEls.get(msg.partId);
          if (!el) {
            el = document.createElement('div');
            el.className = 'tool-call';
            const span = document.createElement('span');
            span.className = 'tool-name';
            el.appendChild(span);
            el.appendChild(document.createTextNode(''));
            messagesEl.appendChild(el);
            toolEls.set(msg.partId, el);
          }
          el.className = 'tool-call ' + (msg.status || 'running');
          el.firstChild.textContent = msg.tool || 'tool';
          el.lastChild.textContent = ' ' + (msg.status || 'running');
          scrollToBottom(false);
          break;
        }
        case 'done':
          if (activeAssistantEl) {
            if (msg.html) activeAssistantEl.innerHTML = msg.html;
            const badge = document.createElement('div');
            const agentSpan = document.createElement('span');
            agentSpan.className = 'agent-badge';
            agentSpan.textContent = msg.agent || 'build';
            badge.appendChild(agentSpan);
            activeAssistantEl.prepend(badge);
            if (msg.tokens > 0) {
              const tok = document.createElement('div');
              tok.className = 'tokens';
              tok.textContent = msg.tokens.toLocaleString() + ' tokens';
              activeAssistantEl.appendChild(tok);
            }
          } else if (msg.text) {
            // No stream came through — render the final text as a fallback.
            const el = document.createElement('div');
            el.className = 'message assistant md';
            el.innerHTML = msg.html || '';
            messagesEl.appendChild(el);
          }
          activeAssistantEl = null;
          break;
        case 'error':
          addMessage('error', msg.message);
          break;
        case 'cleared':
          streamEls.clear();
          toolEls.clear();
          activeAssistantEl = null;
          break;
        case 'modelSelected':
          document.getElementById('model-label').textContent = msg.model;
          break;
        case 'agentInfo':
          document.getElementById('model-label').textContent =
            (msg.modelID || '') + ' (' + (msg.agent || 'build') + ')';
          break;
      }
    });
    inputEl.focus();
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Minimal HTML sanitizer tailored for markdown output.
// Strips unsafe tags, every on* attribute, and non-safe URL schemes.
// CSP already blocks inline/loaded scripts; this closes remaining vectors
// (form actions, iframe embeds, javascript: / data: hrefs, srcdoc, etc.).
const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title"]),
  code: new Set(["class"]),
  pre: new Set(["class"]),
  span: new Set(["class"]),
  td: new Set(["align"]),
  th: new Set(["align"]),
};
const SAFE_URL = /^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i;

function sanitizeHtml(html: string): string {
  // Drop anything we don't explicitly allow. Walk tags with a regex; for each
  // opening tag, either rewrite with filtered attrs or strip entirely.
  // Text nodes/entities pass through marked already-escaped.
  return html.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (match, closing, rawName, attrs) => {
    const name = String(rawName).toLowerCase();
    if (!ALLOWED_TAGS.has(name)) {return "";}
    if (closing) {return `</${name}>`;}

    const allowed = ALLOWED_ATTRS[name];
    if (!allowed) {return `<${name}>`;}

    let rewritten = "";
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(attrs)) !== null) {
      const attr = m[1].toLowerCase();
      if (attr.startsWith("on")) {continue;}
      if (!allowed.has(attr)) {continue;}
      const value = m[3] ?? m[4] ?? m[5] ?? "";
      if ((attr === "href" || attr === "src") && !SAFE_URL.test(value.trim())) {continue;}
      rewritten += ` ${attr}="${value.replace(/"/g, "&quot;")}"`;
    }
    return `<${name}${rewritten}>`;
  });
}
