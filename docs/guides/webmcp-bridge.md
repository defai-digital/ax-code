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
