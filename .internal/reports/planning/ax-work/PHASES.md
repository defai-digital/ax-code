Status: Active
Scope: planning
Last reviewed: 2026-08-12
Owner: AX Work + AX Code Desktop

# AX Work — dual-track plan (product split)

Related: PRD-2026-08-12-ax-work-split, ADR-053, SPEC-2026-08-12-ax-work-split,
SPLIT-REVIEW.md.

Supersedes the in-app 8-phase plan that assumed Work | Code in one Desktop.

**Status 2026-08-12:** A1–A4 implemented in this repo. Track B lives in
`~/code/ax-work` (protocol copied, helper crate, closed allowlist,
qualification evidence checked in).

## Track A — this repo (ax-code)

### A1 — Remove the Work product surface **(done)**

Deleted, not hidden: Work tab, `DesktopSurfaceToggle`,
`useDesktopSurfaceStore`, `WorkHome`, `desktopSurface.ts`, header / empty
state / session-action Work branches, i18n `header.surface.work` and
`work.home.*`.

Legacy `workSession.ts` remains only as a send-block for old rows.

### A2 — Remove Work runtime productization **(done)**

`work` agent + `PROMPT_WORK` + `work.txt` removed. Server cannot resolve
agent `work`. `work-session.ts` only disables send on legacy rows.
`SessionMetadata.Work` is still readable.

### A3 — Relocate computer-use runtime **(done)**

Copied into `~/code/ax-work`, then deleted:

- `src/visual/computer/*`
- `src/tool/computer/*`
- `AX_CODE_EXPERIMENTAL_COMPUTER_AGENT` and registry gates

Kept: `visual/native.ts` and session-scoped `browser_*`.

### A4 — Docs + regression gates **(done)**

Old PRD / ADR-052 D1 / SPEC marked superseded. Tests assert absence of
surface, agent, flag, and computer tool IDs.

## Track B — `~/code/ax-work`

B1 repository scaffold, B2 slim sessions + Alibaba pin, B3 protocol +
permission plane, B4 helper crate, B5 input/safety contract, B6
restricted browser, B7 qualification evidence — implemented in that
repo. Native ScreenCaptureKit / CGEvent actuation remains the live
helper upgrade path; the host state machine and fake backend are the
tested contract.

## Copy versus rewrite

**Copied as seed:** protocol / frame / fake-host, stale-frame / image
budget tests, exact-allow algorithm.

**Rewritten:** registry, prompt, permission store, computer tools
(`resolveTarget` first, ephemeral image channel), model pin, UI, helper.

**Never ported:** bash/edit/write/patch/grep/glob/read/lsp/code-intelligence/
graph/isolation/mcp/plugin/terminal/PTY/git.
