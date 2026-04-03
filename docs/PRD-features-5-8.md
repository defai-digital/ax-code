# PRD: Features 5-8 — i18n, Design Check, Memory Warmup, Context Stats

**Author:** DEFAI Digital
**Date:** 2026-03-30
**Priority:** LOW-MEDIUM
**Source:** Ported from ax-cli

---

## Feature 5: i18n (Internationalization)

### What It Does
Translates all user-facing text in ax-code into 11 languages: English, Simplified Chinese, Traditional Chinese, Japanese, Korean, Spanish, French, German, Portuguese, Thai, Vietnamese.

### Why
- Expands user base to non-English developers
- Matches what ax-cli offered
- Developers in Asia (China, Japan, Korea) are a large market

### How It Works
```
User sets language:
  ax-code config set language zh-CN

All UI text changes:
  "Thinking..." → "思考中..."
  "File created" → "文件已创建"
  "Permission denied" → "权限被拒绝"
```

### Scope
| Component | What Gets Translated |
|---|---|
| TUI status messages | "Thinking...", "Generating...", "Completed" |
| Tool output | "File created", "Command running", "Search results" |
| Error messages | "Connection failed", "Rate limited", "Timeout" |
| Toast notifications | "Copied to clipboard", "Changes saved" |
| CLI command output | "providers list" headers, "models" output |

### What Does NOT Get Translated
- LLM responses (model responds in whatever language it wants)
- Code output
- File paths
- Provider/model names

### Technical Design
```
src/i18n/
├── index.ts          — Main exports: getTranslations(lang), setLanguage(lang)
├── types.ts          — TypeScript interfaces for all translation keys
├── loader.ts         — Loads JSON files, caches, fallback to English
└── locales/
    ├── en/ui.json    — English translations (source of truth)
    ├── zh-CN/ui.json — Simplified Chinese
    ├── ja/ui.json    — Japanese
    ├── ko/ui.json    — Korean
    ├── es/ui.json    — Spanish
    ├── fr/ui.json    — French
    ├── de/ui.json    — German
    ├── pt/ui.json    — Portuguese
    ├── zh-TW/ui.json — Traditional Chinese
    ├── th/ui.json    — Thai
    └── vi/ui.json    — Vietnamese
```

### Config
```json
// ax-code.json
{
  "language": "zh-CN"
}
```

### Effort
- Types + loader + English JSON: 2 hours
- 10 language JSON files: 3 hours (machine translation + manual review)
- Integration into TUI: 2 hours
- Testing: 1 hour
- **Total: ~1 day**

### Success Criteria
- `ax-code --language zh-CN` shows Chinese text
- Fallback to English when translation key missing
- No performance impact (translations loaded once at startup)

---

## Feature 6: Design Check System

### What It Does
Scans CSS/React code for design violations: hardcoded colors, raw spacing values, missing alt text, missing form labels, inline styles.

### Why
- Enforces design system consistency
- Catches accessibility issues early
- Was a differentiator in ax-cli

### How It Works
```
ax-code design-check src/

# Output:
src/components/Button.tsx
  Line 15: [ERROR] no-hardcoded-colors — Use design token instead of #ff0000
  Line 23: [WARN]  no-raw-spacing — Use spacing token instead of 16px
  Line 45: [ERROR] missing-alt-text — Image missing alt attribute

Summary: 2 errors, 1 warning
Coverage: 85% color tokens, 72% spacing tokens
```

### Rules (5 total)
| Rule | Severity | What It Detects |
|---|---|---|
| `no-hardcoded-colors` | ERROR | Hex (#fff), rgb(), hsl(), named colors not using tokens |
| `no-raw-spacing` | WARN | px values not using spacing tokens |
| `no-inline-styles` | WARN | Inline style attributes in JSX/HTML |
| `missing-alt-text` | ERROR | `<img>` without alt attribute |
| `missing-form-labels` | ERROR | `<input>` without associated label |

### Auto-Fix Support
```
ax-code design-check src/ --fix

# Automatically replaces:
#ff0000 → var(--color-red-500)
16px → var(--spacing-4)
```

### Config
```json
// .ax-code/design.json
{
  "rules": {
    "no-hardcoded-colors": "error",
    "no-raw-spacing": "warn",
    "no-inline-styles": "off"
  },
  "include": ["src/**/*.tsx", "src/**/*.css"],
  "ignore": ["node_modules", "dist"],
  "tokens": {
    "spacing": ["0", "px", "0.5", "1", "2", "4", "8", "16", "32"],
    "colors": {}
  }
}
```

### Technical Design
```
src/design-check/
├── index.ts       — Main entry: runDesignCheck(paths, options)
├── config.ts      — Config loader + discovery
├── types.ts       — Types for rules, results, config
├── scanner.ts     — File scanning + reading
├── fixer.ts       — Auto-fix application
└── rules/
    ├── index.ts           — Rule registry
    ├── colors.ts          — no-hardcoded-colors
    ├── spacing.ts         — no-raw-spacing
    ├── inline-styles.ts   — no-inline-styles
    ├── alt-text.ts        — missing-alt-text
    └── form-labels.ts     — missing-form-labels
```

### Effort
- Rule implementations: 3 hours
- Scanner + config: 2 hours
- Auto-fix: 2 hours
- CLI command: 1 hour
- **Total: ~1 day**

### Success Criteria
- Scans .tsx/.css files and finds violations
- Reports with file:line and severity
- Auto-fix works for colors and spacing
- Config allows customizing rules

---

## Feature 7: Memory Warmup

### What It Does
Pre-scans the project and generates a cached context file (`memory.json`) with project structure, README summary, config files, and code patterns. This context is injected into the system prompt for better AI responses.

### Why
- First response is more accurate (AI knows the project)
- Enables implicit caching (repeated context = cheaper API calls)
- Reduces "tell me about this project" repetition

### How It Works
```
# Generate project memory
ax-code memory warmup

# Output:
Scanning project...
  Directory structure: 1,200 tokens
  README summary: 800 tokens
  Config files: 500 tokens
  Code patterns: 400 tokens
Total: 2,900 tokens (saved to .ax-code/memory.json)

# Memory auto-included in system prompt on next session
```

### What It Pre-Loads
| Source | What | Max Tokens |
|---|---|---|
| Directory structure | Top 3 levels of src/, lib/, app/ | ~1,500 |
| README summary | First 500 words of README.md | ~1,000 |
| Config files | package.json scripts, tsconfig paths | ~800 |
| Code patterns | Detected frameworks, patterns, tech stack | ~500 |
| **Total** | | **~4,000** (configurable up to 8,000) |

### Commands
```bash
ax-code memory warmup          # Generate/refresh memory
ax-code memory warmup --dry-run # Show what would be cached
ax-code memory status          # Show current memory stats
ax-code memory clear           # Delete cached memory
```

### Technical Design
```
src/memory/
├── index.ts              — Main exports
├── generator.ts          — Scans project, generates context
├── store.ts              — Read/write .ax-code/memory.json
├── injector.ts           — Injects memory into system prompt
└── types.ts              — Type definitions
```

### Storage
```json
// .ax-code/memory.json
{
  "version": 1,
  "created": "2026-03-30T10:00:00Z",
  "updated": "2026-03-30T10:00:00Z",
  "contentHash": "sha256:abc123...",
  "maxTokens": 4000,
  "sections": {
    "structure": { "content": "...", "tokens": 1500 },
    "readme": { "content": "...", "tokens": 1000 },
    "config": { "content": "...", "tokens": 800 },
    "patterns": { "content": "...", "tokens": 400 }
  },
  "totalTokens": 3700
}
```

### Effort
- Generator (scan + tokenize): 3 hours
- Store (read/write JSON): 1 hour
- Injector (system prompt): 1 hour
- CLI commands: 1 hour
- **Total: ~0.5-1 day**

### Success Criteria
- `ax-code memory warmup` generates memory.json
- Memory auto-injected into system prompt
- First AI response references project correctly
- Memory regenerates when project changes (content hash)

---

## Feature 8: Context Stats

### What It Does
Shows real-time breakdown of what's consuming the context window: system prompt, tools, conversation history, memory, and available space.

### Why
- Users don't know why responses get worse in long sessions (context full)
- Helps debug "why is it forgetting things" issues
- Shows token usage and cost

### How It Works
```
# In TUI, run /context or /stats command

╭ Context Window Usage ──────────────────────────╮
│                                                 │
│  Total: 128,000 tokens                          │
│  Used:   45,230 tokens (35%)     Status: GOOD   │
│  Free:   82,770 tokens                          │
│                                                 │
│  Breakdown:                                      │
│  ████████░░░░░░░░░░░░  System prompt    5,000   │
│  ██████░░░░░░░░░░░░░░  Tool definitions 12,000  │
│  ██░░░░░░░░░░░░░░░░░░  Memory/AX.md     3,000  │
│  ██████████████░░░░░░  History          25,230   │
│                                                 │
│  Session: 15 messages, 8 tool calls              │
│  Cost: $0.12 (45,230 input + 3,400 output)      │
│                                                 │
│  Press Esc to close                              │
╰─────────────────────────────────────────────────╯
```

### Status Levels
| Usage | Status | Color |
|---|---|---|
| 0-50% | GOOD | Green |
| 50-75% | MODERATE | Yellow |
| 75-90% | HIGH | Orange |
| 90-100% | CRITICAL | Red |

### What It Tracks
| Metric | Source |
|---|---|
| System prompt tokens | Estimated from prompt length |
| Tool definition tokens | Estimated from tool count × avg size |
| Memory/AX.md tokens | From memory.json totalTokens |
| Conversation history | Sum of message tokens from session |
| Total input tokens | From LLM API response usage |
| Output tokens | From LLM API response usage |
| Cached tokens | From API response (if provider supports) |
| Estimated cost | Calculated from provider pricing |

### Technical Design
```
src/stats/
├── index.ts          — Main exports
├── collector.ts      — Collects token usage from API responses
├── breakdown.ts      — Calculates context breakdown by category
├── cost.ts           — Cost estimation per provider
└── types.ts          — Type definitions
```

### Integration
- Collector hooks into session/prompt.ts after each LLM call
- Breakdown calculated on-demand when user opens /context
- Cost uses per-provider pricing constants

### Effort
- Collector: 2 hours
- Breakdown calculation: 2 hours
- Cost estimation: 1 hour
- CLI command output: 1 hour
- **Total: ~0.5-1 day**

### Success Criteria
- `/context` shows accurate token breakdown
- Status changes as conversation grows
- Cost estimate matches provider billing
- Warns when context is running low

---

## Implementation Order

| Order | Feature | Effort | Dependencies |
|---|---|---|---|
| 1 | Context Stats (#8) | 0.5-1 day | None |
| 2 | Memory Warmup (#7) | 0.5-1 day | None |
| 3 | i18n (#5) | 1 day | None |
| 4 | Design Check (#6) | 1 day | None |

Start with Context Stats and Memory Warmup — they provide immediate user value with less effort. i18n and Design Check are larger but less urgent.

---

## Total Effort
- Context Stats: 0.5-1 day
- Memory Warmup: 0.5-1 day
- i18n: 1 day
- Design Check: 1 day
- **Total: 3-4 days**

---

*This PRD defines features 5-8 for ax-code, ported from ax-cli concepts with reimplementation for ax-code's architecture.*
