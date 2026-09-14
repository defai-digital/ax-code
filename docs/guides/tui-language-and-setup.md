# TUI languages and first-time setup

Status: Active

Scope: current-state

Last reviewed: 2026-09-14

Owner: ax-code runtime

AX Code's TUI supports English, Traditional Chinese (`zh-TW`), Simplified Chinese (`zh-CN`), Japanese (`ja`), and Korean (`ko`) for the initial localized surfaces: language and setup dialogs, common commands, provider connection choices, permission decisions and warnings, common dialog controls, rollback notices, and Council/Arena status summaries.

Run `/language` (alias `/lang`) to choose the interface language and conversation language independently. The language picker displays each language in its own script. Interface changes apply immediately. Conversation changes apply to subsequent prompts and model-backed slash commands, including Council and Arena requests. `Auto` preserves the existing conversation behavior. Explicit user instructions and project rules take precedence over the preference. Shell commands are sent unchanged.

The original user message is preserved. Conversation preferences are carried separately; AX Code does not translate the task before execution. Code comments, commits, and documents follow project rules, with English requested by default when an explicit conversation preference is selected. Technical identifiers, paths, commands, raw tool output, and quoted evidence remain unchanged.

## First-time setup

A fresh interactive installation with no configured provider or session offers quick setup after initialization:

1. Choose the interface language. All four client languages are available together.
2. Connect a provider and select a model through the existing connection dialogs. Choose an installed coding CLI, cloud API, local runtime, private GPU endpoint, or AX Trust gateway as appropriate.
3. Start a task. A read-only review is a useful first task; inspect commands and their scope before approving.

You can skip setup and reopen it with `/setup`. Cancelling provider setup returns to the checklist. Existing configured users, resumed sessions, and explicit `--prompt` launches are not interrupted. Loading and connection errors remain separate from an unconfigured installation. Selecting a model establishes configuration readiness; the first request checks the live connection. Setup does not grant permissions, install runtimes, or download models automatically.

## Configuration

Optional defaults belong in `tui.json`, not the runtime's legacy `language` setting:

```json
{
  "interface_language": "zh-TW",
  "conversation_language": "ja"
}
```

Interface values: `en`, `zh-TW`, `zh-CN`, `ja`, `ko`. Conversation also accepts `auto`. Defaults are `en` and `auto`. Choices made through `/language` are saved in the local TUI state and override these file defaults. Use `/language` to change them again. Language choices do not change credentials or server policy.

Council/Arena localization changes presentation labels only. Member evidence, support counts, ranking order, verification state and raw errors remain intact. Provider-supplied authorization text, specialized tool output, and other surfaces outside the initial localized set may still appear in their original language. This feature does not translate documentation or every TUI string.

For contributors, `pnpm --dir packages/ax-code run check:tui-locales` validates catalog key/placeholder parity and native dialog rendering. Maintain separate reviewed catalogs for each language; do not derive Traditional Chinese solely through character conversion.
