# AX Code UI/UX TODO Report

Date: 2026-04-03

Scope: existing `ax-code` web/desktop UI, focused on high-value, low to medium risk improvements that can borrow proven patterns from current competitors without needing major backend bets.

## Current Gaps

- The home screen is clean but thin. It mostly offers project open + recent projects, with little guidance toward first success. See [packages/app/src/pages/home.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/home.tsx#L71).
- New session view gives repo/worktree metadata, but not intent shortcuts or suggested next actions. See [packages/app/src/components/session/session-new-view.tsx](/Users/akiralam/code/ax-code/packages/app/src/components/session/session-new-view.tsx#L50).
- The app already tracks rich live state like session status, notifications, todos, permissions, followups, revert points, and diff counts, but these are surfaced in fragmented places. See [packages/app/src/pages/layout/sidebar-items.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/layout/sidebar-items.tsx#L200), [packages/app/src/pages/session/composer/session-todo-dock.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/session/composer/session-todo-dock.tsx#L42), [packages/app/src/pages/session/composer/session-permission-dock.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/session/composer/session-permission-dock.tsx#L8), [packages/app/src/pages/session/session-side-panel.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/session/session-side-panel.tsx#L57).
- AX Code already has underlying concepts for reusable instructions and cached project memory, but the UI does not appear to expose them. See [packages/ax-code/src/session/instruction.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/session/instruction.ts#L14), [packages/ax-code/src/memory/store.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/memory/store.ts#L10), [packages/ax-code/src/cli/cmd/memory.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/cli/cmd/memory.ts#L8).

## Priority TODOs

- [ ] P1: Add quick-start workflow chips to `Home`, `NewSessionView`, and the empty composer state.
  Why: competitors reduce blank-page friction by making common intents explicit.
  Borrow from: Cursor product positioning around "build / plan / fix" and Windsurf's explicit `Ask / Plan / Code` mode framing.
  Low-risk shape: add 4-6 chips like `Plan`, `Build`, `Debug`, `Review`, `Explain`, `Fix tests` that prefill the composer or open a new session with a seeded prompt. This can sit on top of the existing prompt examples and slash command plumbing instead of adding new runtime behavior.
  Likely touch points: [packages/app/src/pages/home.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/home.tsx#L71), [packages/app/src/components/session/session-new-view.tsx](/Users/akiralam/code/ax-code/packages/app/src/components/session/session-new-view.tsx#L50), [packages/app/src/components/prompt-input.tsx](/Users/akiralam/code/ax-code/packages/app/src/components/prompt-input.tsx#L73).

- [ ] P1: Build a unified activity inbox for `Needs approval`, `Running`, `Ready`, and `Errored`.
  Why: AX Code already has the state. The gap is aggregation. Users should not need to scan the sidebar, session header, notifications, and docks separately to understand what needs attention.
  Borrow from: Cursor's background agent sidebar and dashboard patterns that group active work and review-ready work in one place.
  Low-risk shape: add an `Activity` drawer or sidebar section that groups current sessions by status using existing `session_status`, unseen notifications, permission requests, todo presence, and response-ready events. Keep it read-first: jump into the session, clear the badge, or answer the permission.
  Likely touch points: [packages/app/src/pages/layout/sidebar-items.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/layout/sidebar-items.tsx#L200), [packages/app/src/pages/layout.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/layout.tsx#L2317), [packages/app/src/context/notification.tsx](/Users/akiralam/code/ax-code/packages/app/src/context/notification.tsx), [packages/app/src/context/global-sync.tsx](/Users/akiralam/code/ax-code/packages/app/src/context/global-sync.tsx).

- [ ] P1: Expose project memory and repo instructions in the UI as a first-class "Project Context" panel.
  Why: this is likely the highest leverage improvement per unit risk because the backend already has memory storage and instruction-file resolution.
  Borrow from: Windsurf `Memories and Rules`, Cursor `Rules`, and GitHub Copilot `prompt files`.
  Low-risk shape: add a settings/project panel that shows:
  `AGENTS.md` / `CLAUDE.md` / `AX.md` presence,
  memory status like token count and last updated,
  buttons for `Open`, `Refresh memory`, and `Clear memory`.
  This makes persistent context visible and editable without inventing a new model behavior.
  Likely touch points: [packages/ax-code/src/session/instruction.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/session/instruction.ts#L14), [packages/ax-code/src/memory/store.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/memory/store.ts#L10), [packages/ax-code/src/cli/cmd/memory.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/cli/cmd/memory.ts#L20), [packages/app/src/components/session/session-header.tsx](/Users/akiralam/code/ax-code/packages/app/src/components/session/session-header.tsx#L131).

- [ ] P2: Turn slash commands into a visible recipe library, not just a hidden typing affordance.
  Why: AX Code already supports slash command discovery, but it is mostly exposed after the user knows to type `/`.
  Borrow from: Claude Code custom slash commands and GitHub Copilot prompt files.
  Low-risk shape: add a small `Recipes` entry point beside the composer controls. Show saved workflows grouped by `Review`, `Refactor`, `Tests`, `Docs`, `Release`, plus custom repo recipes. Selecting one should insert the slash command or full starter prompt into the editor.
  Likely touch points: [packages/app/src/components/prompt-input/slash-popover.tsx](/Users/akiralam/code/ax-code/packages/app/src/components/prompt-input/slash-popover.tsx#L10), [packages/app/src/components/prompt-input.tsx](/Users/akiralam/code/ax-code/packages/app/src/components/prompt-input.tsx#L103).

- [ ] P2: Add a sticky review summary strip with filters and "jump to next file" actions.
  Why: AX Code already knows changed files and change kinds, but the review surface mainly exposes a file count and raw diff browsing.
  Borrow from: competitor emphasis on review-ready work and reduced navigation overhead.
  Low-risk shape: in the review panel header, add chips like `Added`, `Modified`, `Deleted`, `Commented`, plus `Next file` and `Open in editor`. This is mostly view-model work on top of existing diff data.
  Likely touch points: [packages/app/src/pages/session/session-side-panel.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/session/session-side-panel.tsx#L57), [packages/app/src/pages/session/review-tab.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/session/review-tab.tsx#L16).

- [ ] P2: Upgrade permission prompts from raw approval UI to clearer decision UX.
  Why: the current dock is functional, but still reads like tool plumbing. Better copy and grouping would cut hesitation without changing the permission model.
  Borrow from: Claude Code's explicit `/permissions` mental model and the broader competitor trend toward making agent capabilities legible before the user approves.
  Low-risk shape: show a human summary first, move patterns into an expandable detail block, and when several requests arrive close together, offer batch decisions like `Allow once for this task`.
  Likely touch points: [packages/app/src/pages/session/composer/session-permission-dock.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/session/composer/session-permission-dock.tsx#L22).

## Best First 3

- [ ] Ship quick-start workflow chips.
- [ ] Ship the project context panel for memory + instructions.
- [ ] Ship the unified activity inbox.

## Why These 3 First

- They improve first-use success, session continuity, and trust.
- They reuse data and primitives the codebase already has.
- They avoid risky backend work like new execution models, autonomous branching, or deep merge flows.

## Competitor Sources

- Cursor concepts: https://docs.cursor.com/get-started/concepts
- Cursor background agent: https://docs.cursor.com/ja/background-agent
- Cursor rules: https://docs.cursor.com/ja/context/rules
- Cursor product page: https://cursor.com/en-US/product
- Windsurf cascade modes: https://docs.windsurf.com/windsurf/cascade/modes
- Windsurf memories and rules: https://docs.windsurf.com/pt-BR/plugins/cascade/memories
- GitHub Copilot prompt files: https://docs.github.com/en/copilot/concepts/about-customizing-github-copilot-chat-responses
- Claude Code slash commands: https://code.claude.com/docs/en/slash-commands
