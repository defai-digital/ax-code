# WebMCP browser bridge

Status: Experimental
Scope: public, current-state
Last reviewed: 2026-10-09
Owner: AX Code maintainers

The WebMCP bridge lets the agent open pages in an isolated Chrome window,
read them, and (optionally) act on them. It is experimental, off by default,
and needs Chrome 150 or newer.

## Turn it on

Click the **WebMCP** chip in the sidebar footer (or the Home prompt footer).
The click is the consent: no browser starts before it. Clicking again turns
the bridge off and ends every grant below. The browser uses a fresh, isolated
profile, so it holds no logins unless you sign in by hand in its window.

## What the agent can do

| Tier | Tools | Approval |
| ---- | ----- | -------- |
| Pages | list, open, navigate, close pages; run tools a page registers through WebMCP | each call |
| Read | page snapshot, screenshot, console, request metadata | one grant per origin per session |
| Interact | click, hover, wait, fill, fill form, press key, answer dialogs | see below |

Page content is untrusted: a page can try to steer the agent. Output is
labeled with its origin and size-limited.

## Interact tier

It is on in the default entry, and the chip shows `[act]` while it is. To turn
it off, set `interact` to false in the entry's `webmcp` profile; an entry you
saved earlier keeps the tiers it had. `ax-code mcp webmcp --interact` prints an
entry with it on.

- Hovering and ordinary clicks run under one grant per origin, good for 20
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

## Limits

No scripts, uploads, downloads, cookies, request bodies, coordinates or
dragging. Administrators can disable the bridge or either tier with the
managed `webmcp` requirement (`allow`, `allowRead`, `allowInteract`,
`allowedOrigins`); project and user config cannot loosen it.
