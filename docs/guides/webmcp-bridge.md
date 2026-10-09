# WebMCP browser bridge

Status: Experimental
Scope: public, current-state
Last reviewed: 2026-10-09
Owner: AX Code maintainers

The WebMCP bridge lets the agent open pages in an isolated Chrome window,
read them, and (optionally) act on them. It is experimental, off by default,
and needs Chrome 150 or newer.

[WebMCP](https://webmachinelearning.github.io/webmcp/) is a proposed web
standard. A page can register structured tools — a name, a description, and
an input schema — so an agent can call those actions directly. AX Code
consumes tools a page registers, and it can also read and act on the page
itself.

Codex and ChatGPT Work document their built-in browser's version of the same
standard as [site tools](https://learn.chatgpt.com/docs/webmcp). That page
shows how their desktop app turns WebMCP on, how a visitor inspects the tools
a site offers, and how a site author registers a tool. The steps below are
AX Code's.

## Enable it with Chrome

1. Install [Google Chrome](https://www.google.com/chrome/) 150 or newer.
   Chromium at the same major version also works. AX Code starts its own
   Chrome window on a fresh profile and leaves an already-open Chrome window
   alone.
2. Start the terminal UI with `ax-code`.
3. Click the **WebMCP** chip in the sidebar footer, or the same chip on the
   Home prompt footer. The click is the consent. No browser starts before it.
4. AX Code opens that isolated window with the WebMCP feature enabled
   (`--enable-features=WebMCP`). The window holds no logins until you sign in
   there by hand.
5. Ask the agent to open a page. With the product default, navigation is
   unrestricted. A configured or managed origin list narrows it.
6. Click the chip again to turn the bridge off. That ends temporary session
   grants; saved approvals remain until you revoke them in MCP settings.

The chip shows `[act]` while the interact tier is on. The product default
includes that tier. To turn it off, set `interact` to false in the entry's
`webmcp` profile. An entry you saved earlier keeps the tiers it had.

`ax-code mcp webmcp` prints a config snippet. It does not install a package,
connect a server, or write a file. Add `--interact` to print an entry with
the interact tier on, or `--executable-path /absolute/path/to/chrome` to name
a specific Chrome 150+ binary. When that path is set, AX Code checks the
binary's major version before launch.

### Tools in a Chrome window you opened yourself

The isolated window above already has WebMCP enabled. To try page tools in
the Chrome profile you use while building a site, follow
[Chrome's WebMCP guide](https://developer.chrome.com/docs/ai/webmcp):

1. Open `chrome://flags/#enable-webmcp-testing`.
2. Set the flag to **Enabled**.
3. Relaunch Chrome.

That flag applies to the Chrome profile you opened. The AX Code bridge still
starts from the chip.

## What the agent can do

| Tier     | Tools                                                                        | Approval                                                   |
| -------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Pages    | list, open, navigate, close pages; run tools a page registers through WebMCP | each call unless a supported scope was saved               |
| Read     | page snapshot, screenshot, console, request metadata                         | one grant per origin per session, or a saved read approval |
| Interact | click, hover, wait, fill, fill form, press key, answer dialogs               | see below                                                  |

Page content is untrusted: a page can try to steer the agent. Output is
labeled with its origin and size-limited.

## Save an approval

Eligible prompts offer **Add to WebMCP allowlist** with a red background.
Select it, review the scope, then choose **Add and allow**. Saved approvals
apply to this project on this machine and survive browser reconnects and
AX Code restarts.

- Page listing approves `list_pages` for the AX Code browser, including
  titles and URLs from all open origins. It does not approve page content.
- Navigation approves opening or navigating to one exact origin.
- Read approves snapshots, screenshots, console and network metadata on
  one exact origin. Other origins and ports need their own approval.
- Close approves closing any page currently on one exact origin, including
  pages with unsaved work. It is a separate choice: navigation and read
  approvals do not grant it. The target origin is checked again before closing.

After the first read approval, AX Code continues that read in the same call
after checking the page again. A page or bridge change stops the call and
requires a fresh read. It does not replay a failed browser operation.

Navigation restrictions and administrator policy still apply. Saving an
approval does not edit `allowedOrigins`. Typing, consequential clicks,
dialogs and page-registered tools keep their existing
approvals. **Allow once** remains temporary; the countdown never saves a
persistent approval.

Open `/mcp`, select the WebMCP bridge, and press **Ctrl+G** for
**Manage WebMCP allowlist**. Select an entry to revoke it, or choose the
clear option to revoke all saved approvals for that bridge in this project.
Turning the WebMCP chip off disconnects the browser and retains saved choices.

The local store is `~/.local/share/ax-code/webmcp-approvals.json` by default
(XDG data-directory overrides apply). Approvals are bound to the bridge
identity; changing its launch or browser profile requires fresh approval.

### Navigation failures

A navigation error can occur after a page opens or changes. The error reports
a recognized timeout, network or missing-page category when available, without
echoing raw bridge error text. Inspect `list_pages` before deciding whether to
navigate again. Navigation errors do not remove saved approvals.

## Interact tier

Hovering and ordinary clicks run under one grant per origin, good for 20
actions, then the same prompt returns.

- Typing, key presses, dialogs, links, double clicks and clicks whose name
  sounds consequential (submit, pay, delete, authorize, ...) ask every time,
  showing the target and the full value.
- Fields whose name looks like a credential are labeled and masked. Values
  shaped like API keys or private keys are refused: type credentials yourself.
- Actions need a fresh snapshot of the same page; a moved page or unknown
  element is refused. Three refusals in one turn stop further actions.

The name-based checks are heuristics, not a guarantee. The prompt is the
control, so read it.

## Register a tool on your page

Ask the agent to add a tool that reuses logic your page already has, or
register one from the page's JavaScript. Chrome's guide covers the imperative
API and the declarative form API. A minimal read-only tool looks like this:

```js
if (typeof document.modelContext?.registerTool === "function") {
  await document.modelContext.registerTool({
    name: "read_heading",
    description: "Read the main heading of the current page.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async () => ({
      heading: document.querySelector("h1")?.textContent ?? "",
    }),
  })
}
```

A compatible agent can then discover `read_heading` on that page. OpenAI's
[site tools](https://learn.chatgpt.com/docs/webmcp) page walks through the
same idea from the Codex and ChatGPT Work side, including how their built-in
browser lists the tools a site provides.

## Limits

No scripts, uploads, downloads, cookies, request bodies, coordinates or
dragging. Administrators can disable the bridge or either tier with the
managed `webmcp` requirement (`allow`, `allowRead`, `allowInteract`,
`allowedOrigins`); project and user config cannot loosen it.

Servers you add with `ax-code mcp add` are a different trust path. See
[MCP Integrations](../integrations/mcp.md).

## Reproduce and verify a development change

The `browser_workflow` tool freezes acceptance steps before you edit a web
application, runs them through the connected WebMCP bridge, and records
structured assertions. Enable the bridge first. The first supported environment
is a disposable HTTP server on `127.0.0.1`; each run allocates a different port
and temporary data directory, plus a fresh isolated browser context. Persistent
browser profiles are refused. Empty contexts are retained by the upstream bridge
until disconnect; after 32 runs on one connection, reconnect the bridge before
continuing. The workflow never reuses their cookies or storage.

Ask the agent to freeze a scenario with `action: "freeze"`. For example, a
project-owned `test/browser-server.mjs` that accepts a port argument can use:

```json
{
  "action": "freeze",
  "manifest": {
    "version": 1,
    "name": "Search returns a matching result",
    "server": "node test/browser-server.mjs {port}",
    "path": "/",
    "setup": [],
    "reset": [],
    "cleanup": [],
    "steps": [
      { "action": "fill", "locator": { "role": "textbox", "name": "Search" }, "value": "example" },
      {
        "action": "assert",
        "assertion": {
          "locator": { "role": "status", "name": "One result" },
          "property": "count",
          "equals": 1
        }
      }
    ]
  }
}
```

Keep the returned hash. Run with `{"action":"run","hash":"<hash>","server":"webmcp"}`
(use your connected bridge's name). Reproduce the failure, make the change,
and run the **same hash twice**. Each run starts the declared server, opens its
own page, checks the steps, closes the page and stops its server. Lifecycle
commands run in the repository root through the normal shell permissions.
`{port}` expands to the allocated port; `{data}` expands to a quoted temporary
directory. Setup, reset and cleanup commands must terminate within 15 seconds;
readiness has a 15-second deadline and the browser run has a 120-second deadline.
Browser actions keep their existing permissions and interaction budgets.

Supported steps are click, hover, fill, structured assertion and page-tool
contract checks. Locators use an exact role and accessible name. Actions with
zero or multiple matches stop as `unknown`; there is no guessed UID or CSS/script
fallback. Assertions compare count, value, checked or disabled state. An absent
state property is unknown. For asynchronous rendering, add `timeoutMs` (0-10000,
default 0) to an `assert` step. The runner polls fresh structured snapshots
until the assertion matches or the deadline expires; it never repeats the
preceding click or fill. The timeout is frozen with the scenario and retained
in its exported test. Scenarios are bounded to 32 steps and 32 KiB.

`inspect` returns the frozen manifest and runtime receipts. Receipts bind the
scenario to the repository revision/content, operation outcomes, snapshot
hashes and bounded console/network metadata. Changed source, denied operations,
missing evidence, timeouts and incomplete cleanup cannot pass. These results
validate the declared assertions; they do not prove every behavior of the app.
Frozen state and authoritative receipts live in the current runtime session.
After restarting, freeze and qualify again; copied JSON receipts are not
accepted as runtime authority.

### Export a regression test

`{"action":"export","hash":"<hash>"}` returns a standalone Node module using
`playwright-core`. Save the returned code as a project test and run it with
`AX_TEST_WEBMCP_CHROME` pointing to Chrome. It starts the same fixture and uses
fresh browser contexts, stable role/name locators and the frozen assertions.
Actually run the exported test before calling it validated. Exported tests are
an independent regression artifact; their output is not an Arena receipt.
Page-tool contract steps use Chrome's native WebMCP protocol with exact descriptor
hashes and expected output, without evaluating arbitrary page scripts. Chrome
must support that experimental protocol for contract exports.

### Develop a page-tool contract and investigate failures

With a page open, `{"action":"contracts","server":"webmcp","pageId":1}`
returns its registered descriptors and exact descriptor hashes. Freeze a
`contract` step containing `name`, `descriptorHash`, `input`, `resultPath` and
`equals`. Hash changes fail the check. Set `expectError: true` for negative
inputs: only a confirmed page-tool execution error satisfies it; canceled
calls, permission refusal and missing completion are unknown. Add assertions
after mutations to check the resulting page state as well as the return value.

The `template` action takes `name`, a relative application `module`, an explicit
`exportName`, and `schema`. It verifies the local export exists and returns a
registration skeleton. Review it against the application's input validation,
authorization and business logic before enabling it; the tool cannot establish
those guarantees from an exported function name.

An optional `sources` list names repository-local files with one-based `line`
and zero-based `column`, and optionally a local `map` file. Failed runs return
bounded diagnostics and source links labelled `explicit`, `local_map` or
`unresolved`. Mapping is advisory, never proof of a root cause or a passing
assertion. Remote maps, paths outside the repository and files over 1 MiB are
not read. Browser network evidence remains metadata only.

### Require browser evidence in implement Arena

Supply `browserScenario: "<hash>"` with `mode: "implement"`. Freeze the scenario
and record a real failing assertion on the current clean base before starting
the Arena. Every candidate receives that frozen contract in its isolated
worktree and must run it twice successfully through its connected isolated
bridge. Browser activation and permissions remain supervised. Missing bridge
access, stale content, unknown results or missing receipts prevent promotion,
even if the repository checks pass. Normal code verification and mutation
checks still run, and no candidate merges automatically.

### Choose evidence efficiently

Native WebMCP tools describe application operations; Chrome DevTools MCP supplies
browser inspection and automation. Prefer a page's registered tool for an
explicit application operation, then verify its result and resulting page state.
Use accessibility snapshots for text and stable element locators. For layout,
canvas or image-only content, take a screenshot: crop to a fresh snapshot `uid`
or use JPEG with reduced quality to stay within inline limits. Interpreting
pixels requires a vision-capable model. Neither WebMCP nor the documented
DevTools MCP tool list provides a dedicated OCR tool; inferred image text is
advisory and cannot satisfy a structured acceptance assertion.

Narrow console reads with `types` and `pageSize`; narrow network metadata with
`resourceTypes` and `pageSize`. Workflow receipts retain pre-action baselines
and bounded deltas so errors introduced by the reproduction are easier to find.
Network bodies and arbitrary evaluation remain outside the bridge's granted
surface. Performance traces, emulation, Lighthouse, screencasts, memory and
extension tools in upstream DevTools MCP are separate capabilities and are not
exposed by this profile.

See Chrome's [WebMCP debugging guide](https://developer.chrome.com/docs/devtools/agents/webmcp-debugging)
and the upstream [DevTools MCP tool reference](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md).
Upstream main can differ from AX Code's pinned bridge; only the local tool
schemas describe the supported arguments.
