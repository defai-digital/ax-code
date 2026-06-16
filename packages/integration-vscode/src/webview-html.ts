/**
 * Webview HTML template for the chat panel.
 *
 * The HTML is intentionally inlined: VS Code webviews have strict CSP, and
 * shipping separate JS/CSS files would require loading them through
 * `webview.asWebviewUri` plus a more permissive script-src. The nonce-bound
 * inline script keeps the surface area minimal.
 */
import { randomBytes } from "node:crypto"

export function buildChatHtml(nonce: string, cspSource: string): string {
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
    // Track whether the current assistant turn has finalized so late
    // streamText events cannot recreate a duplicate bubble. See #252.
    let turnFinalized = false;

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
            turnFinalized = false;
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
          // Ignore late stream chunks that arrive after the turn finalized to
          // avoid rendering a duplicate assistant bubble. See #252.
          if (turnFinalized) break;
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
          turnFinalized = true;
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
</html>`
}

export function generateNonce(): string {
  // CSP nonces must be cryptographically unpredictable — Math.random() is not
  // a CSPRNG and would weaken the script-src guarantee.
  return randomBytes(16).toString("base64url")
}
