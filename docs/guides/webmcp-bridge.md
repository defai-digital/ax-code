# WebMCP browser bridge

Status: Experimental
Scope: public, current-state
Last reviewed: 2026-10-10
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
   Home prompt footer, or run `/webmcp`. The click or command is the consent.
   No browser starts before it. AX Code first checks, without starting a
   browser, whether a Chrome 150 or newer is installed in the usual places and
   warns you if not; the check is advice and never blocks the attempt. Your
   choice is saved to your user config, so the bridge comes back on at the next
   start without another click.
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

### Prompt hint

While the bridge is off, a prompt that names a URL or a local server (for
example `localhost:3000`) shows a one-line pointer to the chip and `/webmcp`.
It appears at most once per session and three times in total, and it never
changes what is sent to the agent.

## What the agent can do

| Tier     | Tools                                                                                                                                               | Approval                                                   |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Pages    | list, open, navigate, reload, close pages; run tools a page registers through WebMCP                                                                | each call unless a supported scope was saved               |
| Read     | page snapshot, screenshot, console (with stack traces on request), one console message by id, request metadata, viewport presets, one element's CSS | one grant per origin per session, or a saved read approval |
| Interact | click, hover, wait, fill, fill form, press key, answer dialogs                                                                                      | see below                                                  |

Page content is untrusted: a page can try to steer the agent. Output is
labeled with its origin and size-limited.

### Reload, back and forward

`navigate_page` takes `type: reload` (with `ignoreCache` for a hard reload)
so the agent can refresh a page after a code change, and `type: back` or
`forward` to move through the page's history. Every navigation discards the
page's snapshot uids and tool listing; the agent snapshots again before it
acts. Reload follows the same approval as navigating to the page's origin.
Back and forward have no destination to check before the browser moves, so
they ask you each time, are never saved and never run automatically, and are
refused on a bridge whose origin list is narrowed: navigate by URL there. The
landing origin is checked after the move. Unsaved page state can be lost by
any of these, exactly as when you reload by hand.

Console messages can include stack traces (`includeStackTraces`), and one
message can be fetched by its `msgid` with `get_console_message`. Local file
paths in frames are redacted before the model sees them; page URLs keep
their path but lose secret-looking query values.

### Viewport presets and CSS styles

`emulate` sets the viewport to one of four presets and accepts nothing else:
`375x812x1,mobile,touch` (phone), `768x1024x1,mobile,touch` (tablet),
`1280x800x1` (laptop) and `1440x900x1` (desktop). Throttling, geolocation,
user agent, colour scheme and extra headers are refused. A viewport change
invalidates the page's snapshot uids, so the agent snapshots again before it
acts. (`resize_page` is not used: it resizes the window, and Chrome keeps
windows at least about 500 pixels wide, so a phone width is unreachable.)

`get_css_styles` takes a `uid` from the latest snapshot and returns that
element's matched rules, inline and inherited styles and cascade, ten rules
per page (`pageIdx` pages through the rest). Use it for layout, spacing and
override questions instead of guessing from a screenshot. Stylesheet URLs
lose secret-looking query values and local file paths.

Both tools run under the page origin's read grant. The `responsive-check`,
`a11y-check` and `webmcp-audit` skills build on these reads (see "Skills for
WebMCP").

One request's headers (`get_network_request`) are not available: the pinned
bridge stalls on responses marked `Cache-Control: no-store` and then stops
answering every later call, so the tool stays off until that is fixed
upstream. Request metadata from `list_network_requests` is unaffected.

### Auto mode and Sandbox

With **Auto** and **Sandbox** on, an enabled, connected WebMCP browser runs
ordinary browsing without an **Allow once** prompt: list pages, open or navigate
within the existing origin policy, discover page tools, read page content, and
grant bounded ordinary interaction. Read and interaction grants remain temporary;
ordinary clicks, hover and waits still use the existing interaction budget.
The native Desktop browser also lists its page tools without a prompt.

With **Sandbox off**, Auto also admits typing (`fill` and `fill_form`), key
presses, dialogs, links, double clicks, consequential-looking clicks, closing
pages and registered page-tool invocations immediately. A page tool whose
listing declares it consequential keeps its prompt in every mode, and history
navigation (back, forward) always asks. This applies to the
live AX Code bridge and to bound native Desktop listing and invocation. Initial
read and interaction grants also proceed without a countdown. Repeated actions
do not create persistent approvals.

With **Sandbox on**, closing pages, expanding an origin allowlist, typing, key presses, dialogs,
links, double clicks, consequential-looking clicks and page-defined tool
invocations keep their existing approval requirements. Page declarations of
"read-only" do not qualify an invocation for automatic approval. Sandbox limits
local operations; website actions can still change external accounts and data.

Explicit deny rules, administrator policy and browser identity/origin checks
remain enforced. Automatic browsing does not save persistent approvals.
With Auto off, the existing approval flow applies. Origin allowlist expansion
and explicitly interactive requests keep their approval requirements in every
mode. Unsupported tools, credential-shaped inputs and invalid or stale targets
remain rejected. Requests without live runtime authority retain the existing
approval flow, including the eligible full-access Auto countdown.

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
approval does not edit `allowedOrigins`. Saved approvals do not authorize
typing, consequential clicks, dialogs or page-registered tools; their admission
follows the Auto/Sandbox rules above. **Allow once** remains temporary; the countdown never saves a
persistent approval.

Select the **WebMCP allowlist** link beside the WebMCP chip (session
sidebar footer and Home prompt footer), run `/webmcp-allowlist`, or open
`/mcp`, select the bridge, and press **Ctrl+G**. Double click an entry (or
press Enter twice) to revoke it; the first activation marks the row and a
second one within a few seconds confirms, so a single click never revokes.
The clear row revokes all saved approvals for that bridge in this project
the same way. Long lists scroll. Press Escape or click outside the panel to
close it.

The search box also adds approvals. Type an exact `https://` origin (or
`http://localhost`), then select the navigation, read or close row to save
it; a page-listing row is offered until it is saved. The bridge must be
connected: an explicit approval binds to the running bridge identity and is
checked at every call exactly like one saved from a prompt, so managed origin
lists, the read-tier switch and administrator policy still apply.
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

## Work with an existing page

Ask AX Code to inspect the page's capabilities, develop its native tools, or
diagnose a specific behavior. The `browser_workflow` tool groups these tasks
without requiring you to start a test server for ordinary observations. Enable
the bridge first and identify the intended page; none of these actions opens a
page, signs in, changes the browser profile or schedules future work.

For example: "Inspect the tools on my local app and show which application
functions they correspond to," or "Capture this page before I reproduce the
blank results, then compare the errors and point me to candidate source files."

### Inspect native tools and their source

Call `status` with `server`, `pageId` and the exact `origin` to see the actual
admitted tools and native/snapshot availability. An empty listing does not
establish that inaccessible frames have no tools. Existing connectors may be
better suited to tasks that do not need page context.

```json
{
  "action": "inventory",
  "server": "webmcp",
  "pageId": 1,
  "origin": "http://localhost:3000",
  "sourceFiles": ["src/tools.ts", "public/search.html"]
}
```

Keep the returned `inventoryId`. Pass it as `baselineId` on a later inventory
call to see added/removed tools and changed schema fields. Files are explicitly
permission-checked, repository-contained and bounded. Static imperative
registrations and quoted HTML form attributes produce source candidates;
computed names, duplicate definitions and unsupported templates remain
unresolved or ambiguous. A matching name and schema corroborate a candidate,
but do not prove that the browser loaded that source revision.

### Generate an application integration

Use `author` to return reviewable integration code:

```json
{
  "action": "author",
  "name": "find_products",
  "description": "Find products matching a query in the current catalog.",
  "module": "./src/catalog.js",
  "exportName": "findProducts",
  "schema": {
    "type": "object",
    "properties": { "query": { "type": "string" } },
    "required": ["query"]
  },
  "format": "imperative",
  "effect": "read"
}
```

The named function must be a direct export. The generated registration takes
an AbortSignal for component/route cleanup. Set `acceptsSignal: true` only when
the application function accepts a second `{signal}` argument and honors it.
`format: "declarative"` returns a form plus a module binding for human
submission; connect its `webmcp-result` event to the application's UI. Primitive
fields are supported; unsupported schema constraints are rejected instead of
silently discarded. Review application validation, authorization and actual
effects before applying either template. Field edits may trigger autosave even
when a form requires human submission.

### Check execution and model selection separately

Existing `contract` steps verify fixed inputs and expected results. Add
`{"action":"tool_presence","name":"admin_reset","present":false}`
after a route or role change to check that an unavailable operation was
unregistered. `present: true` can also pin `descriptorHash`. These are lifecycle
checkpoints, not an event trace. Exported regressions include the same checks.

Use a separate selection evaluation to discover whether a model chooses the
right tool and arguments:

```json
{
  "action": "selection_eval",
  "inventoryId": "<returned inventory UUID>",
  "cases": [
    { "task": "Find AX products", "expected": { "name": "find_products", "arguments": { "query": "AX" } } },
    { "task": "Delete every product", "expected": { "name": null, "arguments": {} } }
  ],
  "repeats": 2
}
```

The selected API model receives only the task and captured catalog, with no
execution tools or expected answers. Calls are approved and bounded to 12
cases, three repeats and a two-minute evaluation deadline. The report records
model identity, a suite hash, separate exact choice/argument counts, joint
correctness and unknown outcomes. Failures stay in the denominator. CLI models
are unavailable for this evaluation because they can run their own tools.
Selection scores do not prove tool correctness or qualify Arena.

### Diagnose before and after an action

Call `observe` with the same page target, optional `sourceFiles`, and explicit
`assertions` using the existing role/name and count/value/checked/disabled
schema. Perform the requested action once through an approved tool or by hand.
Then call `{"action":"diagnose","observationId":"<returned UUID>"}`.
The result compares assertion outcomes, snapshot hashes, bounded console and
request metadata deltas, semantic inventory changes and source candidates.
Correlation is evidence to investigate, not a proven root cause. Without
assertions the status is `observed`, not `pass`.

Baselines are held only in the current runtime session, expire after 30 minutes
and are limited to 16 per session. Connection/page-location changes invalidate
reuse. The pinned bridge cannot identify a same-URL reload, so these comparisons
remain advisory. Only hashes of page locations and snapshots are retained;
bounded diagnostic text and tool descriptors are untrusted evidence.

For a reproducible localhost problem, `promote` takes the observation ID and
an explicit normal `manifest` containing the local test-server command and
steps. It freezes a new controlled scenario. Observation results are never
copied into acceptance: run a failing control before editing and qualify the
fixed runs through the existing workflow.

### Repeat a daily observation task

An on-demand recipe checks an existing page without navigation or scheduling:

```json
{
  "action": "recipe",
  "server": "webmcp",
  "pageId": 1,
  "definition": {
    "version": 1,
    "name": "Preview health",
    "origin": "http://localhost:3000",
    "assertions": [{ "locator": { "role": "status", "name": "Ready" }, "property": "count", "equals": 1 }]
  }
}
```

The default is snapshot-only. Optional `queries` contain an exact tool `name`,
`descriptorHash`, object `input`, `resultPath` and `equals`. They invoke real
application tools under existing per-call approval; read-only hints do not
certify effects. The result explicitly distinguishes snapshot observation from
application calls with unverified effects, and rechecks snapshots after queries.
Save reviewed definitions, not captured contents or credentials. Definitions
carry no permission and never become Arena receipts. A pass means only the
declared observations matched; missing data cannot satisfy a check.

## Register a tool manually

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

## Skills for WebMCP

Two built-in skills cover bridge work. `webmcp` verifies a web app through
the connected bridge, authors and checks page tools, and runs the structured
observation and diagnosis workflows. `browser-troubleshooting` diagnoses
bridge enable, launch, connection, policy and grant failures and reports the
blocker and remedy. Load it instead of retrying when the chip, a bridge
tool, or a browser approval fails.

Project skills load from `.ax-code/skills/`, `.agents/skills/`,
`.claude/skills/` and `.opencode/skills/`. See the
[skill catalog](../reference/skills-and-plugins.md).

Third-party skills below are reading and authoring material only; AX Code
has not tested them and does not certify them for this bridge.

- Google's `build-webmcp-tools` skill
  ([GoogleChromeLabs/webmcp-tools](https://github.com/GoogleChromeLabs/webmcp-tools),
  Apache-2.0) installs with
  `npx skills add GoogleChromeLabs/webmcp-tools --path webmcp-skills`, or by
  copying `skills/build-webmcp-tools` into `.agents/skills/`. It designs and
  audits page tools and writes `schema.json` / `evals.json` for
  `npx webmcp-evals`. Note: its instructions name Chrome DevTools MCP tools
  such as `evaluate_script` that this bridge does not admit; the agent must
  use the admitted snapshot and `browser_workflow` actions instead.
- Google's Modern Web Guidance skill pack
  (`npx modern-web-guidance@latest install`; guides CC-BY 4.0, see the
  [docs](https://developer.chrome.com/docs/modern-web-guidance)) includes
  the WebMCP guides `agentic-forms` and `agentic-javascript-tools`.
- The upstream `chrome-devtools-mcp` repository ships skills
  (`a11y-debugging`, `debug-optimize-lcp`, `memory-leak-debugging`,
  `troubleshooting`; see
  [skills](https://github.com/ChromeDevTools/chrome-devtools-mcp/tree/main/skills)).
  They assume `evaluate_script` and Lighthouse, which this profile does not
  expose, so use them as reading material, not as runnable recipes.

## Limits

No scripts, uploads, downloads, cookies, request bodies, coordinates or
dragging. Administrators can disable the bridge or either tier with the
managed `webmcp` requirement (`allow`, `allowRead`, `allowInteract`,
`allowedOrigins`); project and user config cannot loosen it.

Servers you add with `ax-code mcp add` are a different trust path. See
[MCP Integrations](../integrations/mcp.md).

## Debug a localhost page in five steps

For a page that renders wrong, a control that does nothing, or a request that
fails:

1. Navigate to the page and take a snapshot — the a11y tree is the structural
   baseline. Navigation and reads use the existing approvals.
2. Perform the failing action once, under the existing interaction approvals.
3. Read the delta: console errors and network metadata (method, URL, status,
   type — request and response bodies stay out of scope) around the action.
   For asynchronous state, wait; never repeat the triggering action.
4. Verdict: PASS, FAIL, or BLOCKED with the missing capability named. A tool
   acknowledgement is not proof of application success.
5. If the localhost failure can be expressed as a structured assertion, freeze
   it as a `browser_workflow` scenario (below), record the failing control, and
   run the same hash twice after the fix.

### Attach evidence to a bug report

For a localhost failure investigated through a frozen scenario, an evidence
bundle makes the report reviewable: the scenario name and hash, the failing
assertion result (without captured page content), the receipt IDs from
`browser_workflow inspect`, snapshot hashes, the bounded console error and
network metadata deltas, source links with their
`explicit`/`local_map`/`unresolved` labels, and the origin. Include only
runtime-bounded, runtime-redacted output — never request or response bodies,
headers, cookies, storage, page content, or credential-shaped values. Receipt
IDs and copied receipt data are references only; authoritative receipt state
remains runtime-owned.

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
surface. Performance traces, other device emulation, Lighthouse,
screencasts, memory and extension tools in upstream DevTools MCP are separate
capabilities and are not exposed by this profile; `emulate` is admitted only
for the four viewport presets, and `get_css_styles` for one element at a time.

See Chrome's [WebMCP debugging guide](https://developer.chrome.com/docs/devtools/agents/webmcp-debugging)
and the upstream [DevTools MCP tool reference](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md).
Upstream main can differ from AX Code's pinned bridge; only the local tool
schemas describe the supported arguments.
