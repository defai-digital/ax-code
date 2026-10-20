import { inspectorScript } from "./inspector-client"
import type { ListToolsResult } from "@modelcontextprotocol/server"

/** Static, dependency-free inspector. Screen text is always assigned through textContent. */
export function tuiInspectorPage(capability: string, nonce: string, tools: ListToolsResult["tools"]) {
  const bootstrap = JSON.stringify({ capability, tools }).replaceAll("<", "\\u003c")
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AX Code · TUI Inspector</title><style nonce="${nonce}">
:root{color-scheme:dark;font:14px system-ui;background:#0b1119;color:#dbe4ef}*{box-sizing:border-box}body{margin:0;padding:28px;max-width:1600px;margin-inline:auto}header{display:flex;justify-content:space-between;align-items:center;gap:16px}h1{font-size:24px;margin:0}h1 span{font-weight:400}p{color:#9baec3;line-height:1.6}small{color:#9baec3}.badge{padding:6px 12px;background:#123f36;color:#a3edd7;border-radius:20px}main{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:20px;margin-top:24px}section,aside{background:#111d2a;border:1px solid #26394c;border-radius:12px;padding:18px;min-width:0}h2{font-size:14px;color:#9baec3;margin:0 0 14px;text-transform:uppercase;letter-spacing:.1em}pre{white-space:pre;overflow:auto;margin:0;font:13px/1.45 ui-monospace,monospace}#screen{min-height:340px;background:#080d14;padding:16px;border-radius:7px}#meta{margin:14px 0;color:#9baec3}#details{white-space:pre-wrap;max-height:320px;font-size:11px}form{margin-bottom:20px}label{display:block;color:#9baec3;margin-bottom:7px}input,select,textarea,button{font:inherit;border-radius:6px;border:1px solid #36516c;background:#0b1623;color:#dbe4ef;padding:9px;max-width:100%}textarea{width:100%;min-height:75px;resize:vertical}button{cursor:pointer;background:#183c4b}button:hover{background:#24576a}button:disabled{opacity:.5;cursor:wait}.row{display:flex;gap:8px;align-items:center;margin-top:8px}.row input[type=number]{width:90px}#status{margin-top:16px;white-space:pre-wrap;overflow-wrap:anywhere}#webmcp{font-size:12px}a{color:#92d7e4}@media(max-width:850px){body{padding:16px}main{grid-template-columns:1fr}}
</style></head><body>
<header><h1>AX Code <span>/ TUI Inspector</span></h1><span class="badge">Local development</span></header>
<p>Inspect the running terminal interface and test its real input path. Input can trigger real actions. Pending approvals and questions require the person at the terminal.</p>
<main><section><h2>Native frame</h2><div class="row"><button id="refresh">Refresh screen</button><label><input type="checkbox" id="live"> Live refresh</label></div><div id="meta">Connecting…</div><pre id="screen" aria-label="Native TUI screen">Waiting for a rendered frame.</pre><p><small>Text mirror of the last rendered frame. Terminal images, font shaping and exact colors require verification in the terminal.</small></p><h2>Latest result</h2><pre id="details"></pre><h2>Recent input receipts</h2><pre id="receipts"></pre></section>
<aside><h2>Input controls</h2>
<form id="keys"><label for="key">Key</label><select id="key"><option>enter</option><option>escape</option><option>tab</option><option>backspace</option><option>delete</option><option>up</option><option>down</option><option>left</option><option>right</option><option>home</option><option>end</option><option>pageup</option><option>pagedown</option><option>p</option><option>c</option></select><div class="row"><label><input id="ctrl" type="checkbox"> Ctrl</label><label><input id="shift" type="checkbox"> Shift</label><label><input id="metaKey" type="checkbox"> Meta</label></div><button>Send key</button></form>
<form id="paste"><label for="text">Paste text</label><textarea id="text" maxlength="4096" placeholder="Text for the focused input"></textarea><button>Paste</button></form>
<form id="resize"><label>Renderer dimensions</label><div class="row"><input id="cols" aria-label="Columns" type="number" min="20" max="300" value="100"><span>×</span><input id="rows" aria-label="Rows" type="number" min="8" max="150" value="30"></div><div class="row"><button>Resize</button></div></form>
<form id="click"><label>Click cell (zero-based)</label><div class="row"><input id="x" aria-label="Column" type="number" min="0" value="0"><input id="y" aria-label="Row" type="number" min="0" value="0"></div><div class="row"><button id="click-submit" disabled>Click observed frame</button></div></form>
<form id="wait"><label for="condition">Wait for visible text</label><input id="condition" maxlength="1024"><div class="row"><button>Wait up to 3s</button></div></form>
<h2>Agent access</h2><p id="webmcp">Checking WebMCP support…</p><div id="status" role="status"></div></aside></main>
<script nonce="${nonce}">
const boot=${bootstrap};
${inspectorScript}
</script></body></html>`
}
