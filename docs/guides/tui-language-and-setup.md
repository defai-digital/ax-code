# TUI languages and first-time setup

Status: Active

Scope: current-state

Last reviewed: 2026-09-14

Owner: ax-code runtime

AX Code's TUI supports English (`en`), Traditional Chinese (`zh-TW`), Simplified Chinese (`zh-CN`), Japanese (`ja`), Korean (`ko`), Spanish (`es`), Brazilian Portuguese (`pt-BR`), French (`fr`), German (`de`), Russian (`ru`), Indonesian (`id`), Turkish (`tr`), Vietnamese (`vi`), and Italian (`it`). Localized surfaces include setup, navigation, common commands, keyboard help, prompt controls, provider choices, permission decisions, session dialogs, runtime status, and Council/Arena presentation.

Run `/language` (alias `/lang`) to choose the interface language and conversation language independently. The language picker displays each language in its own script. Interface changes apply immediately. Conversation changes apply to subsequent prompts and model-backed slash commands, including Council and Arena requests. `Auto` preserves the existing conversation behavior. Explicit user instructions and project rules take precedence over the preference. Shell commands are sent unchanged.

The original user message is preserved. Conversation preferences are carried separately; AX Code does not translate the task before execution. Code comments, commits, and documents follow project rules, with English requested by default when an explicit conversation preference is selected. Technical identifiers, paths, commands, raw tool output, and quoted evidence remain unchanged.

## First-time setup

A fresh interactive installation with no configured provider or session offers quick setup after initialization:

1. Choose the interface language. All fourteen languages are available together; use the arrow keys to scroll the list in short terminals.
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

Interface values: `en`, `zh-TW`, `zh-CN`, `ja`, `ko`, `es`, `pt-BR`, `fr`, `de`, `ru`, `id`, `tr`, `vi`, `it`. Conversation also accepts `auto`. Defaults are `en` and `auto`. Choices made through `/language` are saved in the local TUI state and override these file defaults. Use `/language` to change them again. Language choices do not change credentials or server policy.

Council/Arena localization changes presentation labels only. Member evidence, support counts, ranking order, verification state and raw errors remain intact. Provider-supplied authorization text, specialized tool output, and specialized diagnostic surfaces may still appear in their original language. Raw tool output, technical identifiers, user content, and documentation are not translated.

For contributors, `pnpm --dir packages/ax-code run check:tui-locales` validates complete catalogs, placeholders, NFC normalization, reviewed shared spellings, core menu source guards, and native dialog rendering with live language changes. Maintain separate reviewed catalogs for each language; do not derive Traditional Chinese solely through character conversion.

Vietnamese catalogs use NFC. Display truncation preserves grapheme clusters, including decomposed input. Native rendering checks cover 36- and 80-column terminals. Terminals configured to render ambiguous-width characters as two cells require separate terminal-specific qualification; the current renderer does not expose an ambiguous-wide test mode.
