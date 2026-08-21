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
      padding: 8px 10px;
      overflow-x: auto;
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
    /* Code block wrapper + toolbar (added client-side after markdown render) */
    .codeblock {
      margin: 0.5em 0;
      border-radius: 4px;
      overflow: hidden;
    }
    .codeblock pre { margin: 0; border-radius: 0 0 4px 4px; }
    .code-toolbar {
      display: flex;
      gap: 4px;
      align-items: center;
      padding: 2px 6px;
      background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.1));
      border-bottom: 1px solid var(--vscode-widget-border, transparent);
      border-radius: 4px 4px 0 0;
    }
    .code-lang {
      font-size: 0.75em;
      color: var(--vscode-descriptionForeground);
      margin-right: auto;
    }
    .code-toolbar button {
      font-size: 0.75em;
      padding: 1px 6px;
      background: transparent;
      color: var(--vscode-descriptionForeground);
      border: none;
      border-radius: 3px;
      cursor: pointer;
    }
    .code-toolbar button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
      color: var(--vscode-foreground);
    }
    .msg-head {
      display: flex;
      gap: 6px;
      align-items: center;
      margin-bottom: 4px;
    }
    .msg-copy-btn {
      font-size: 0.75em;
      padding: 1px 6px;
      background: transparent;
      color: var(--vscode-descriptionForeground);
      border: none;
      border-radius: 3px;
      cursor: pointer;
    }
    .msg-copy-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
      color: var(--vscode-foreground);
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
    #attachments {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 0 8px;
    }
    .attachment-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.8em;
      padding: 2px 6px;
      border-radius: 3px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .attachment-remove {
      background: transparent;
      border: none;
      color: inherit;
      cursor: pointer;
      padding: 0 2px;
      font-size: 1em;
      line-height: 1;
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
    <div class="status" data-placeholder="1">Ask AX Code to explain, review, or change your code</div>
  </div>
  <div id="attachments"></div>
  <div id="input-area">
    <textarea id="input" rows="1" placeholder="Ask AX Code..." aria-label="Ask AX Code"></textarea>
    <button id="send-btn">Send</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send-btn');
    const attachmentsEl = document.getElementById('attachments');
    // partId -> DOM element for the streaming assistant text bubble.
    const streamEls = new Map();
    let activeAssistantEl = null;
    // The assistant bubble for the current turn. Unlike activeAssistantEl (which
    // 'done' nulls out), this survives until the next turn starts, so a 'done'
    // event whose activeAssistantEl was lost still decorates the streamed bubble
    // instead of appending a duplicate. See #262.
    let turnAssistantEl = null;
    let toolEls = new Map();
    let isProcessing = false;
    // Track whether the current assistant turn has finalized so late
    // streamText events cannot recreate a duplicate bubble. See #252.
    let turnFinalized = false;
    // Raw markdown text of finalized assistant messages, for the Copy button.
    const messageTexts = new WeakMap();
    // Pasted images waiting to be sent: { mime, url, filename }.
    let attachments = [];
    // Input history (persisted across webview reloads via vscode.setState).
    const HISTORY_LIMIT = 50;
    const savedState = vscode.getState();
    let inputHistory = savedState && Array.isArray(savedState.inputHistory)
      ? savedState.inputHistory
          .filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
          .slice(-HISTORY_LIMIT)
      : [];
    let historyIndex = -1;
    let historyDraft = '';
    // A stream render deferred because the user is selecting text inside the
    // streaming bubble (re-rendering would destroy the selection).
    let deferredStream = null;

    function persistHistory() {
      vscode.setState({ inputHistory: inputHistory });
    }

    function resizeInput() {
      inputEl.style.height = '36px';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
    }

    function send() {
      const text = inputEl.value.trim();
      if ((!text && attachments.length === 0) || isProcessing) return;
      inputEl.value = '';
      resizeInput();
      if (text && inputHistory[inputHistory.length - 1] !== text) {
        inputHistory.push(text);
        if (inputHistory.length > HISTORY_LIMIT) inputHistory.shift();
        persistHistory();
      }
      resetHistoryNavigation();
      const images = attachments.map((a) => ({ mime: a.mime, url: a.url, filename: a.filename }));
      attachments = [];
      renderAttachments();
      vscode.postMessage({ type: 'send', text: text, images: images });
      // Local echo happens via 'userMessage' reply from provider to avoid duplicates.
    }

    function historyNavigate(direction) {
      // direction: -1 = older (ArrowUp), +1 = newer (ArrowDown)
      if (inputHistory.length === 0) return;
      if (historyIndex === -1) {
        if (direction === 1) return;
        historyDraft = inputEl.value;
        historyIndex = inputHistory.length - 1;
      } else {
        historyIndex += direction;
      }
      if (historyIndex >= inputHistory.length) {
        historyIndex = -1;
        inputEl.value = historyDraft;
      } else {
        if (historyIndex < 0) historyIndex = 0;
        inputEl.value = inputHistory[historyIndex];
      }
      resizeInput();
      inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
    }

    function resetHistoryNavigation() {
      historyIndex = -1;
      historyDraft = '';
    }

    function cursorOnFirstLine() {
      return inputEl.selectionStart <= (inputEl.value.indexOf('\\n') === -1 ? inputEl.value.length : inputEl.value.indexOf('\\n'));
    }
    function cursorOnLastLine() {
      return inputEl.selectionEnd >= inputEl.value.lastIndexOf('\\n') + 1;
    }

    function handleKeyDown(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); return; }
      if (e.key === 'ArrowUp' && cursorOnFirstLine()) { e.preventDefault(); historyNavigate(-1); return; }
      if (e.key === 'ArrowDown' && cursorOnLastLine()) { e.preventDefault(); historyNavigate(1); return; }
      // Once the user edits a recalled entry, it becomes a fresh draft. Do not
      // let a later ArrowDown replace the edit with the pre-navigation draft.
      if (historyIndex !== -1 && !e.metaKey && !e.ctrlKey && !e.altKey) resetHistoryNavigation();
      setTimeout(resizeInput, 0);
    }

    function handlePaste(e) {
      const items = (e.clipboardData && e.clipboardData.items) || [];
      let hasImage = false;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type && item.type.indexOf('image/') === 0) {
          hasImage = true;
          const file = item.getAsFile();
          if (!file) continue;
          const mime = item.type;
          const name = file.name || ('pasted-image.' + mime.split('/')[1]);
          const reader = new FileReader();
          reader.onload = () => {
            attachments.push({ mime: mime, url: reader.result, filename: name });
            renderAttachments();
          };
          reader.readAsDataURL(file);
        }
      }
      // Only swallow the paste when it is purely images — a text+image
      // clipboard should still paste its text into the input.
      if (hasImage && !(e.clipboardData && e.clipboardData.getData('text'))) {
        e.preventDefault();
      }
    }

    function renderAttachments() {
      attachmentsEl.innerHTML = '';
      attachments.forEach((a, i) => {
        const chip = document.createElement('span');
        chip.className = 'attachment-chip';
        chip.textContent = a.filename || a.mime;
        const remove = document.createElement('button');
        remove.className = 'attachment-remove';
        remove.textContent = '\\u00d7';
        remove.setAttribute('data-remove-attachment', String(i));
        remove.setAttribute('aria-label', 'Remove attachment');
        chip.appendChild(remove);
        attachmentsEl.appendChild(chip);
      });
    }

    function clearChat() {
      messagesEl.innerHTML = '<div class="status" data-placeholder="1">Chat cleared</div>';
      streamEls.clear();
      toolEls.clear();
      activeAssistantEl = null;
      turnAssistantEl = null;
      deferredStream = null;
      turnFinalized = true;
      vscode.postMessage({ type: 'clear' });
    }

    // Remove empty-state / 'Chat cleared' placeholder status text once real
    // conversation content is rendered, so stale status lines don't look like
    // part of the transcript. See #263.
    function removePlaceholderStatus() {
      messagesEl.querySelectorAll('.status[data-placeholder="1"]').forEach(s => s.remove());
    }

    function stopAgent() { vscode.postMessage({ type: 'stop' }); }
    function selectModel() { vscode.postMessage({ type: 'selectModel' }); }

    document.getElementById('btn-model').addEventListener('click', selectModel);
    document.getElementById('btn-clear').addEventListener('click', clearChat);
    document.getElementById('btn-stop').addEventListener('click', stopAgent);
    document.getElementById('send-btn').addEventListener('click', send);
    inputEl.addEventListener('keydown', handleKeyDown);
    inputEl.addEventListener('paste', handlePaste);

    function copyText(text, btn) {
      const done = () => {
        if (!btn) return;
        const label = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = label; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, () => legacyCopy(text, done));
      } else {
        legacyCopy(text, done);
      }
    }
    function legacyCopy(text, done) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) { /* best effort */ }
      ta.remove();
      done();
    }

    // Wrap every rendered <pre> in a toolbar'd container. Runs after each
    // markdown render; already-wrapped blocks are skipped.
    function decorateCodeBlocks(root) {
      root.querySelectorAll('pre').forEach((pre) => {
        if (pre.parentElement && pre.parentElement.classList.contains('codeblock')) return;
        const code = pre.querySelector('code');
        let language = '';
        if (code) {
          const match = (code.className || '').match(/language-(\\S+)/);
          if (match) language = match[1];
        }
        const wrapper = document.createElement('div');
        wrapper.className = 'codeblock';
        const toolbar = document.createElement('div');
        toolbar.className = 'code-toolbar';
        const lang = document.createElement('span');
        lang.className = 'code-lang';
        lang.textContent = language;
        toolbar.appendChild(lang);
        [['Copy', 'copy'], ['Insert', 'insert'], ['New file', 'newfile']].forEach((spec) => {
          const btn = document.createElement('button');
          btn.textContent = spec[0];
          btn.setAttribute('data-code-action', spec[1]);
          toolbar.appendChild(btn);
        });
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(toolbar);
        wrapper.appendChild(pre);
      });
    }

    // One delegated click handler for code-toolbar buttons, message copy
    // buttons, and attachment chips (CSP forbids inline handlers).
    messagesEl.addEventListener('click', (e) => {
      const codeBtn = e.target.closest('button[data-code-action]');
      if (codeBtn) {
        const wrapper = codeBtn.closest('.codeblock');
        const pre = wrapper && wrapper.querySelector('pre');
        const code = pre ? pre.textContent : '';
        const action = codeBtn.getAttribute('data-code-action');
        if (action === 'copy') {
          copyText(code, codeBtn);
        } else if (action === 'insert') {
          vscode.postMessage({ type: 'insertAtCursor', code: code });
        } else if (action === 'newfile') {
          const lang = wrapper.querySelector('.code-lang');
          vscode.postMessage({ type: 'openInNewFile', code: code, language: lang ? lang.textContent : '' });
        }
        return;
      }
      const msgBtn = e.target.closest('button[data-copy-message]');
      if (msgBtn) {
        const el = msgBtn.closest('.message');
        copyText((el && messageTexts.get(el)) || '', msgBtn);
      }
    });
    attachmentsEl.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('button[data-remove-attachment]');
      if (!removeBtn) return;
      attachments.splice(Number(removeBtn.getAttribute('data-remove-attachment')), 1);
      renderAttachments();
    });

    function selectionInside(el) {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
      // A backwards selection anchors outside the bubble and focuses inside it,
      // so checking only anchorNode still destroys that selection on refresh.
      return [sel.anchorNode, sel.focusNode].some((node) => !!node && el.contains(node));
    }

    function flushDeferredStream() {
      if (!deferredStream) return;
      const pending = deferredStream;
      deferredStream = null;
      if (pending.done) {
        applyDone(pending.done, pending.el);
        return;
      }
      pending.el.innerHTML = pending.html || '';
      decorateCodeBlocks(pending.el);
    }

    function finalizeAssistant(target, msg) {
      if (target.dataset.finalized === '1') return;
      target.dataset.finalized = '1';
      if (msg.html) target.innerHTML = msg.html;
      decorateCodeBlocks(target);
      messageTexts.set(target, msg.text || '');
      const head = document.createElement('div');
      head.className = 'msg-head';
      const agentSpan = document.createElement('span');
      agentSpan.className = 'agent-badge';
      agentSpan.textContent = msg.agent || 'build';
      head.appendChild(agentSpan);
      const copyBtn = document.createElement('button');
      copyBtn.className = 'msg-copy-btn';
      copyBtn.textContent = 'Copy';
      copyBtn.setAttribute('data-copy-message', '1');
      head.appendChild(copyBtn);
      target.prepend(head);
      if (msg.tokens > 0) {
        const tok = document.createElement('div');
        tok.className = 'tokens';
        tok.textContent = msg.tokens.toLocaleString() + ' tokens';
        target.appendChild(tok);
      }
      scrollToBottom(false);
    }

    function applyDone(msg, target) {
      if (target) {
        finalizeAssistant(target, msg);
      } else if (msg.text) {
        // No stream came through — render the final text as a fallback.
        const el = document.createElement('div');
        el.className = 'message assistant md';
        messagesEl.appendChild(el);
        turnAssistantEl = el;
        finalizeAssistant(el, msg);
      }
      activeAssistantEl = null;
    }
    document.addEventListener('selectionchange', () => {
      if (deferredStream && !selectionInside(deferredStream.el)) flushDeferredStream();
    });

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
        turnAssistantEl = el;
      }
      return el;
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'userMessage':
          removePlaceholderStatus();
          addMessage('user', msg.text);
          break;
        case 'prefill': {
          // Never clobber an unsent draft — append below it instead.
          const incoming = msg.text || '';
          const draft = inputEl.value.trim();
          inputEl.value = draft ? inputEl.value.replace(/\\s+$/, '') + '\\n\\n' + incoming : incoming;
          resetHistoryNavigation();
          resizeInput();
          inputEl.focus();
          inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
          break;
        }
        case 'insertText': {
          const insert = msg.text || '';
          const start = inputEl.selectionStart == null ? inputEl.value.length : inputEl.selectionStart;
          const end = inputEl.selectionEnd == null ? start : inputEl.selectionEnd;
          inputEl.value = inputEl.value.slice(0, start) + insert + inputEl.value.slice(end);
          resetHistoryNavigation();
          const pos = start + insert.length;
          inputEl.setSelectionRange(pos, pos);
          resizeInput();
          inputEl.focus();
          break;
        }
        case 'status':
          if (msg.status === 'thinking' || msg.status === 'initializing') {
            isProcessing = true; sendBtn.disabled = true;
            turnFinalized = false;
            // A new turn is starting; drop the previous turn's bubble reference
            // so 'done' can't decorate a stale element. See #262.
            turnAssistantEl = null;
            const label = msg.status === 'initializing' ? 'Starting AX Code...' : 'Thinking...';
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
          // First stream chunk — remove the live 'Thinking...' placeholder and
          // any empty-state/cleared placeholder status. See #263.
          messagesEl.querySelectorAll('.status[data-live="1"]').forEach(s => s.remove());
          removePlaceholderStatus();
          const el = getOrCreateStreamEl(msg.partId);
          // Defer the render while the user is selecting text inside the
          // bubble — replacing innerHTML would destroy their selection.
          if (selectionInside(el)) {
            deferredStream = { el: el, html: msg.html };
          } else {
            if (deferredStream && deferredStream.el === el) deferredStream = null;
            el.innerHTML = msg.html || '';
            decorateCodeBlocks(el);
          }
          scrollToBottom(false);
          break;
        }
        case 'toolUpdate': {
          // Clear/stop/error/done can race with a final SSE tool snapshot. Do
          // not resurrect tool rows after the turn has already finalized.
          if (turnFinalized) break;
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
        case 'done': {
          turnFinalized = true;
          removePlaceholderStatus();
          // Prefer the live ref, but fall back to the turn's streamed bubble so
          // a lost activeAssistantEl does not cause a duplicate append. Only
          // append a fresh bubble when nothing was rendered for this turn, and
          // never decorate the same bubble twice (idempotent done). See #262.
          const target = activeAssistantEl || turnAssistantEl;
          // Final rendering is still a re-render. Defer all finishing touches
          // until the selection leaves, just like an intermediate stream chunk.
          if (target && selectionInside(target)) {
            deferredStream = { el: target, html: msg.html, done: msg };
            activeAssistantEl = null;
            break;
          }
          if (deferredStream && (!target || deferredStream.el === target)) deferredStream = null;
          applyDone(msg, target);
          break;
        }
        case 'error':
          turnFinalized = true;
          activeAssistantEl = null;
          addMessage('error', msg.message);
          break;
        case 'cleared':
          streamEls.clear();
          toolEls.clear();
          activeAssistantEl = null;
          turnAssistantEl = null;
          deferredStream = null;
          turnFinalized = true;
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
