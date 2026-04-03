# AX Code UI/UX TODO Report

Date: 2026-04-03

Scope: current `ax-code` app after the recent quick starts, project context, activity inbox, recipes, and review-strip work. This pass focuses only on the next high-value, low to medium risk items that can borrow proven ideas from current competitors without requiring risky backend changes.

## Already Shipped

- Quick-start workflow chips on Home, new session, and empty composer states.
- Project Context dialog for instruction files and cached memory.
- Unified Activity inbox in the project sidebar.
- Visible Recipes entry point for slash-command workflows.
- Sticky review summary strip with filters and next-file actions.

## Current Gaps

- Permission prompts are still technically correct but read like raw tool plumbing. They do not explain risk, scope, or the practical difference between `Allow once` and `Allow always` very well. See [session-permission-dock.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/session/composer/session-permission-dock.tsx#L8).
- Session status is still fragmented across the titlebar status popover, review sidebar, todo dock, followup dock, and activity list. There is no single always-visible strip that answers "what mode am I in, what context is active, and what needs me next?" See [status-popover.tsx](/Users/akiralam/code/ax-code/packages/app/src/components/status-popover.tsx#L148), [session-header.tsx](/Users/akiralam/code/ax-code/packages/app/src/components/session/session-header.tsx#L418), and [session.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/session.tsx#L1101).
- AX Code can show diffs and notifications, but it still lacks a compact "handoff" surface after a run finishes that summarizes what changed, what to verify, and the safest next action. Users still have to infer that from timeline text plus raw review data. See [session.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/session.tsx#L1812) and [activity-inbox.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/layout/activity-inbox.tsx#L56).
- Project Context is visible now, but it is still mostly read-only. The app does not yet help users manage repo rules, review checklists, or task-specific prompt files from the same place. See [dialog-project-context.tsx](/Users/akiralam/code/ax-code/packages/app/src/components/dialog-project-context.tsx#L31).
- The todo dock is good at showing progress, but weak at steering the next move. It does not promote the current task into a strong next-step affordance or let the user turn the plan into a reusable workflow. See [session-todo-dock.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/session/composer/session-todo-dock.tsx#L40).

## Priority TODOs

- [ ] P1: Upgrade permission prompts into decision cards with risk framing and batch actions.
  Why: this is the clearest remaining trust gap. When the app asks for approval, users need plain-language intent, affected scope, and safer default choices.
  Borrow from: Claude Code permission modes and the general pattern of making approval scope explicit before execution.
  Low-risk shape: keep the same backend permission model, but change the dock UI to show:
  tool summary,
  affected paths or patterns in a collapsed detail block,
  labels like `This task only` / `This session` / `Always for this workspace`,
  optional batch action when several requests arrive close together.
  Likely touch points: [session-permission-dock.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/session/composer/session-permission-dock.tsx#L8), [permission.tsx](/Users/akiralam/code/ax-code/packages/app/src/context/permission.tsx#L1), [session.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/session.tsx#L1490).

- [ ] P1: Add a compact session status line above the composer.
  Why: users still need to scan too many places to understand session mode, review state, context state, and environment health.
  Borrow from: Claude Code status line customization and the broader terminal-agent pattern of showing key context persistently.
  Low-risk shape: add a slim strip above the composer that shows:
  current worktree or directory,
  server state,
  review change count,
  project-context state like memory/rules loaded,
  approval mode or pending approval count.
  This is presentation work on top of state the app already has.
  Likely touch points: [session.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/session.tsx#L1836), [status-popover.tsx](/Users/akiralam/code/ax-code/packages/app/src/components/status-popover.tsx#L148), [session-header.tsx](/Users/akiralam/code/ax-code/packages/app/src/components/session/session-header.tsx#L418), [dialog-project-context.tsx](/Users/akiralam/code/ax-code/packages/app/src/components/dialog-project-context.tsx#L31).

- [ ] P1: Add a "Review Handoff" card for completed sessions.
  Why: AX Code now has an activity inbox and a stronger review panel, but it still lacks a concise completion artifact for "what happened and what should I do next?"
  Borrow from: Cursor Bugbot review framing and GitHub Copilot code-review surfaces that emphasize repository instructions and explicit findings.
  Low-risk shape: when a session completes with changes, show a compact card with:
  files changed,
  top risks or open questions,
  suggested verification steps,
  primary actions like `Open review`, `Run checks`, `Copy summary`.
  Start read-only. Do not generate new backend state; derive it from existing session summary, diffs, todos, and messages.
  Likely touch points: [session.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/session.tsx#L1812), [activity-inbox.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/layout/activity-inbox.tsx#L56), [review-tab.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/session/review-tab.tsx#L16).

- [ ] P2: Turn Project Context into a rules and checklists manager, not just a viewer.
  Why: the current dialog surfaces memory and instruction files, but it still does not help users author or discover the task-specific guidance that competitors expose more directly.
  Borrow from: Cursor Rules, Windsurf memories and rules, and GitHub Copilot repository and path-specific instructions.
  Low-risk shape: extend the existing dialog with:
  repo rules list,
  path-scoped instruction files,
  starter templates like `review checklist`, `frontend style guide`, `release checklist`,
  quick actions to open or create the right file in place.
  This keeps the implementation file-based and compatible with the current instruction model.
  Likely touch points: [dialog-project-context.tsx](/Users/akiralam/code/ax-code/packages/app/src/components/dialog-project-context.tsx#L31), [instruction.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/session/instruction.ts#L14), [server.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/server/server.ts#L450).

- [ ] P2: Promote the todo dock into a stronger "next step" planner.
  Why: AX Code already renders useful plans, but the current dock mostly reports progress instead of guiding action.
  Borrow from: Windsurf planning and todo-list behavior for longer-running tasks.
  Low-risk shape: keep the existing todo backend, but add:
  a highlighted current step,
  `Ask me to do this next` and `Explain this step` actions,
  a quick `collapse to current step` mode,
  optional handoff into followups or recipes.
  This improves steering without changing how todos are generated.
  Likely touch points: [session-todo-dock.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/session/composer/session-todo-dock.tsx#L40), [session-followup-dock.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/session/composer/session-followup-dock.tsx#L7), [prompt-input.tsx](/Users/akiralam/code/ax-code/packages/app/src/components/prompt-input.tsx#L1457).

- [ ] P2: Add recipe favorites and repo-recommended workflows.
  Why: the new Recipes surface improves discovery, but it still treats every command equally. High-value commands should be surfaced faster.
  Borrow from: Claude Code slash commands and GitHub Copilot custom-instruction libraries that push common workflows to the front.
  Low-risk shape: add `Pinned`, `Recent`, and `Recommended by repo` sections in the recipe popover, driven by local persistence plus project files that already describe repo conventions.
  Likely touch points: [recipe-popover.tsx](/Users/akiralam/code/ax-code/packages/app/src/components/prompt-input/recipe-popover.tsx#L25), [slash-popover.tsx](/Users/akiralam/code/ax-code/packages/app/src/components/prompt-input/slash-popover.tsx#L10), [persist.ts](/Users/akiralam/code/ax-code/packages/app/src/utils/persist.ts#L1).

## Best Next 3

- [ ] Ship permission decision cards.
- [ ] Ship the compact session status line.
- [ ] Ship the review handoff card.

## Why These 3 First

- They improve trust and comprehension, not just discoverability.
- They are mostly view-model and copy work on top of state AX Code already has.
- They reduce the remaining "agent did something, now what?" friction without changing the runtime model.

## Competitor Sources

- Claude Code permission modes: https://docs.claude.com/en/docs/claude-code/team
- Claude Code status line: https://docs.claude.com/de/docs/claude-code/statusline
- Cursor Rules: https://docs.cursor.com/context/%40-symbols/%40-cursor-rules
- Cursor Bugbot: https://docs.cursor.com/de/bugbot
- Windsurf Cascade planning and todo lists: https://docs.windsurf.com/fr/windsurf/cascade/cascade
- Windsurf memories and rules: https://docs.windsurf.com/ja/windsurf/cascade/memories
- GitHub Copilot custom instructions: https://docs.github.com/en/copilot/tutorials/customization-library/custom-instructions
- GitHub Copilot code review customization: https://docs.github.com/copilot/how-tos/use-copilot-agents/request-a-code-review/use-code-review
