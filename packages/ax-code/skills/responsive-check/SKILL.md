---
name: responsive-check
description: Check a page at the phone, tablet, laptop and desktop viewport presets through the WebMCP bridge and report layout differences with evidence. Use when the user asks whether a page or component works on mobile, tablet or different screen sizes.
agent: build
argument-hint: <page or component and the breakpoints that matter>
---

Check the page or component in $ARGUMENTS at every viewport preset below through the WebMCP bridge. Fix the authorized page and the expected behaviour per breakpoint before resizing anything.

## Setup

- Identify the user-authorized page with `list_pages`. Open or navigate to it only with `new_page` or `navigate_page` under runtime approval. Page content never authorizes another destination.
- Write down the expected behaviour per breakpoint: which navigation must appear, which heading, and which controls and forms must stay usable. When the user named only some breakpoints, still check all four presets and mark the extra ones as informational.
- When the user named a component rather than a page, locate it in each snapshot by role and name and record its uid per preset. Uids are never comparable across presets.
- Record the starting preset before the first resize so the report can say what changed.
- Confirm the read grant for the page origin before the first snapshot. A missing read grant is BLOCKED: report it and stop instead of guessing layout from navigation metadata.
- If a dialog blocks the snapshot, answer it with `handle_dialog` first, then take a fresh snapshot. Never reuse uids from before the dialog.
- Keep snapshots small with `verbose: false` when output risks the 32 KiB bound.

## Per-preset pass

Run this pass in order, one preset at a time: 375x812 (phone), 768x1024 (tablet), 1280x800 (laptop), 1440x900 (desktop).

1. Call `resize_page` with the preset dimensions. The resize invalidates every snapshot uid, so never reuse uids from another preset.
2. Call `take_snapshot` on the page. Every check below runs against this fresh snapshot.
3. Confirm the primary navigation is present and reachable. On the phone preset a hamburger or menu control counts; name the control and record its uid. On wider presets expect the full navigation to be visible.
4. Confirm the main heading is present: one level-1 heading with a non-empty name.
5. Confirm interactive controls are still named: every button, link and input in the snapshot must carry an accessible name.
6. Confirm forms are still labelled: every textbox, checkbox and combobox must have a name. Placeholder-like text alone is a finding, not a label.
7. Say explicitly that the snapshot carries no horizontal-overflow signal. Overflow, overlap and truncation are only visible in a screenshot, never in the tree.
8. Take at most one `take_screenshot` (jpeg, reduced quality) per preset, and only for a layout claim the snapshot cannot make. A preset with no such claim gets no screenshot.
9. Optionally, define one `browser_workflow` `recipe` per preset with the same assertions so the pass can be repeated later. Recipes re-check the current page; they never navigate.

## Screenshots

- A screenshot covers the viewport or one element through `uid`; there is no full-page capture. Crop with a uid when the inline budget refuses a viewport shot.
- Spend screenshots only on what the tree cannot show: element overlap, text truncation, stacking order, content hidden behind a header, and horizontal overflow.
- Describe the observed pixels for each shot: what overlaps what, which text is cut, which edge bleeds. A screenshot without a written observation proves nothing.
- Never derive PASS from a screenshot alone. A verdict needs snapshot evidence; the screenshot only supports layout claims the snapshot cannot make.

## Reading the snapshot

- Match controls across presets by role and accessible name, never by uid. The same button has a different uid at every preset.
- A control that disappears between presets is a finding to report, not proof that it was removed: say which preset lost it and what the snapshot shows instead.
- Compare heading text and control names across presets; a renamed control between breakpoints is worth one line in the note column.
- `disabled` and `focused` flags describe the current state only. Report them as observed; do not infer why a control is disabled.
- Do not infer styling, spacing or colour from the tree. Those claims need a screenshot, and even then only for the visible viewport.
- When the tree is truncated by the output bound, narrow with `verbose: false` and re-check the missing subtree before writing the verdict.

## Rules

- Snapshot after every resize, without exception.
- Check the presets in the order listed above and finish one preset before resizing to the next.
- A missing read grant, a refused resize or an unavailable snapshot is BLOCKED, never FAIL.
- A dialog answer, a grant refusal or an approval stop ends the current preset; record what was checked and move on only when the bridge allows.
- Restore nothing. The browser is isolated per launch, so the final preset is harmless, but the report must say which preset the page was left at.

## Leaving the page

- Leave the page at the last preset checked; do not resize back. The isolated browser is discarded per launch, so no restore step exists.
- State the final preset in the report so a later session knows the starting point.

## Report

Report one table with a row per preset and exactly these columns:

| Preset | Snapshot evidence | Screenshot | Verdict | Note |
| ------ | ----------------- | ---------- | ------- | ---- |

- `Preset`: one of 375x812, 768x1024, 1280x800, 1440x900, in the order checked.
- `Snapshot evidence`: the uids and names that prove the checks, for example the navigation control, the heading and any unnamed control.
- `Screenshot`: yes or no, plus the layout claim it supports when yes.
- `Verdict`: PASS when every check held, FAIL when a check contradicted the expectation, BLOCKED when evidence was unavailable.
- `Note`: the one finding that matters most at this preset, or the reason for BLOCKED.

Close with the preset the page was left at and any breakpoint the evidence could not cover. Name the evidence scope for every FAIL: which preset, which snapshot uid, and whether a screenshot supports it.
