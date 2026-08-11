# Protocol Steps: design-check

- Unit slug: `design-check`
- Resolved root: `packages/ax-code/src/design-check`
- Reviewer lane: ax-code-glm
- Independent verifier lane: codex-sol
- Baseline commit: `5fefa00cdc847667d3ba3d38509a751498ee4180`

These nine steps were performed against the source at
`/Users/akiralam/code/ax-code/packages/ax-code/src/design-check/` (8 files,
~470 LOC) plus its sole consumer at
`/Users/akiralam/code/ax-code/packages/ax-code/src/cli/cmd/design-check.ts`.

## Step 1 Scope and inventory

The `design-check` unit is a small rule-based scanner that walks a file tree
and flags design / accessibility violations. The actual files reviewed:

- `packages/ax-code/src/design-check/index.ts` (142 lines) — orchestrator:
  `findFiles`, `runDesignCheck` (line 56), `formatResult` (line 116), and the
  `DEFAULT_CONFIG` / `SCANNABLE_EXTENSIONS` constants at lines 16 and 28.
- `packages/ax-code/src/design-check/types.ts` (54 lines) — `Severity`,
  `RuleConfig`, `DesignCheckConfig`, `Violation`, `FileResult`, `CheckResult`,
  `Rule`.
- `packages/ax-code/src/design-check/rules/index.ts` (12 lines) — exports
  `ALL_RULES` array in a fixed order.
- `packages/ax-code/src/design-check/rules/colors.ts`, `spacing.ts`,
  `inline-styles.ts`, `alt-text.ts`, `form-labels.ts` — one `Rule` per file.

Single consumer: `packages/ax-code/src/design-check/rules/../../cli/cmd/design-check.ts`
imports `runDesignCheck` and `formatResult` (line 3) and wires them into a
yargs subcommand registered from `src/cli/boot.ts:13`. No other importer
exists in the repo (grep over `from ".*design-check"` returned only this file
plus the module's own self-reference in a doc comment).

## Step 2 Public surface and contract

The exported API is `runDesignCheck`, `formatResult`, and re-exported types
(index.ts:142). The documented contract (index.ts:7-8 docstring) is
"import { runDesignCheck } from '../design-check'" and call it with a `rules`
map. The CLI consumer at `design-check.ts:37-39` passes only `{ rules }` and
casts the overrides `as any`, so the type boundary between user CLI input and
the typed config is intentionally erased at the call site — invalid severities
from `--rule foo=bar` reach the engine unchecked (see Step 4).

`DesignCheckConfig` (types.ts:15-23) declares three knobs: `rules`, `include`,
`ignore`, plus an optional `tokens` map. Of these, only `rules` and `ignore`
are actually consulted by the orchestrator. `include` is parsed into the
default config but `runDesignCheck` never reads it back — it filters purely on
`SCANNABLE_EXTENSIONS` (index.ts:43, 67). `tokens` is never read by any rule
or by the orchestrator (grep for `cfg.tokens` / `config.tokens` across
`packages/ax-code/src` returned zero hits in this module). Two of the four
documented configuration knobs are therefore non-functional.

## Step 3 File traversal and silent error paths

`findFiles` (index.ts:33-51) recurses with an unbounded `walk` helper. Every
filesystem operation that can fail is wrapped in a swallowing `.catch`:

- `fs.readdir(current, { withFileTypes: true }).catch(() => [])` at index.ts:37
  turns permission errors, EACCES, ENOTDIR, and broken-symlink errors into an
  empty entry list. The user is never told a directory was skipped.
- `fs.stat(p).catch(() => null)` at index.ts:63 silently drops unreadable
  paths.
- `fs.readFile(file, "utf-8").catch(() => "")` at index.ts:78 returns an empty
  string, and the next line (`if (!content) continue`) then skips the file
  entirely, so a file that exists but cannot be read is reported in
  `filesScanned` (it was counted at line 66/68) but never actually scanned,
  inflating the count while hiding violations.

For a tool whose only job is to surface violations, these three silent skips
are a correctness defect: a violation-laden file that the process cannot read
produces zero violations and a green summary. The traversal also has no symlink
cycle protection; a recursive symlink under `node_modules`-style paths would
loop until stack overflow. `ignore` is matched by exact directory name only
(index.ts:39), so glob-style ignore patterns in the config are silently
ignored — only bare names like `dist` work.

## Step 4 Configuration merge and severity validation

The merge at index.ts:57 is
`{ ...DEFAULT_CONFIG, ...config, rules: { ...DEFAULT_CONFIG.rules, ...config?.rules } }`.
The nested `rules` is merged correctly, but `tokens` (also a nested object per
types.ts:19-22) would be shallow-replaced, not deep-merged — academic for now
because `tokens` is unused, but the merge is structurally inconsistent.

Severity resolution at index.ts:84-85 is:
`const severity = cfg.rules[rule.name as keyof typeof cfg.rules] ?? rule.defaultSeverity; if (severity === "off") continue;`.
The cast `as keyof typeof cfg.rules` is unsafe — `rule.name` is a runtime
string, and `RuleConfig` (types.ts:7-13) is a closed interface keyed by the
five known rule names. If a sixth rule is added to `ALL_RULES` but not to
`RuleConfig`, the index access falls through to `rule.defaultSeverity`, so the
user literally cannot configure it via `--rule`. There is no validation that
the configured severity is one of `"error" | "warn" | "off"`. The CLI feeds
raw `rule.split("=")` strings (design-check.ts:30-31) into `ruleOverrides` and
casts `as any`. An invalid value like `--rule no-hardcoded-colors=critical`
flows to `v.severity = severity` (index.ts:89) and then neither the
`"error"` nor `"warn"` branch in the summary loop (index.ts:97-99) matches,
so the violation is pushed into `fileResults`, rendered by `formatResult`'s
`else` arm as `WARN` (index.ts:129), but not counted in either
`totalErrors` or `totalWarnings`. The summary line understates reality while
the detail block shows violations — the two disagree.

## Step 5 Color / spacing / inline-style rule precision

`noHardcodedColors` (colors.ts) has three regexes:

- `HEX_PATTERN = /#(?:[0-9a-fA-F]{3,4}){1,2}\b/g` at colors.ts:8 matches any
  `#xxx` / `#xxxxxx` token. It will match URL fragments (`href="#section"`),
  anchor ids in JSX (`href={`#anchor`}`), hex literals in TS code (`0x#fff`
  is impossible, but template tags are not), and CSS-in-JS hex in test
  fixtures. The only filter is a line-level comment skip
  (`line.trim().startsWith("//") || ...` at colors.ts:25), which itself is
  wrong for JSX block comments: a line inside `{/* ... */}` that does not
  start with `*` is scanned as code.
- `RGB_PATTERN` / `HSL_PATTERN` (colors.ts:9-10) match `rgb(...)`, `rgba(...)`,
  `hsl(...)`, `hsla(...)` regardless of context. In a `.tsx` file this also
  matches the string `rgb` inside variable names that happen to be followed
  by parentheses (`gradient(rgbFn(...))` would be a false positive if a
  function name were literally `rgb`).

`noRawSpacing` (spacing.ts) uses `PX_PATTERN = /:\s*(\d+)px/g` at spacing.ts:8.
This only matches a `px` literal that _immediately follows a colon_, so CSS
shorthand like `margin: 0 16px;` (the value `16px` is preceded by a space, not
a colon) is missed entirely, while `padding:16px` is caught. The rule
therefore has uneven coverage of the very thing it claims to detect. The
`ALLOWED_PX` whitelist (`new Set(["0","1","2"])` at spacing.ts:9) is a magic
list with no comment explaining why 0/1/2 are acceptable (borders) while 3 is
not.

`noInlineStyles` (inline-styles.ts) uses two patterns: `style\s*=\s*\{` and
`style\s*=\s*"` (inline-styles.ts:8-9). The first matches any assignment of a
shape like `style = {`. This is a real false-positive source: `const button
style = {` (a variable named `buttonStyle`) does not match because of the
word boundary, but `const style = {...}` (a top-level `style` variable
declaration) _does_ match because the regex does not anchor on `<tagname`.
It also does not match the apostrophe form `style='...'` used by some
templating engines. The comment skip at inline-styles.ts:22 omits the
`/*` case that colors.ts:25 includes, so the three rules are inconsistent in
how they treat block comments.

## Step 6 Accessibility rules depth

`missingAltText` (alt-text.ts):

- Per-line scanning with `IMG_PATTERN = /<img\b[^>]*>/gi` (alt-text.ts:8) means
  a multi-line `<img\n  src=...\n  alt="..."\n/>` JSX tag — the canonical
  React form — is split across lines, so `[^>]*` never spans the newline and
  the tag is not detected at all. Real React codebases will mostly evade this
  rule.
- The presence check `!tag.includes("alt=") && !tag.includes("alt =")`
  (alt-text.ts:26) is a substring test. `data-alt="x"` or `data-noalt="y"`
  would falsely satisfy it because both contain `alt=` as a substring. There
  is no word boundary.
- The rule reports `severity: "error"` literally inside `check`
  (alt-text.ts:29), and index.ts:89 then overwrites it with the configured
  severity. The literal value in the rule body is effectively dead — the
  orchestrator always wins.

`missingFormLabels` (form-labels.ts):

- The label-presence logic (form-labels.ts:29) treats `tag.includes("id=")`
  as evidence of a label. An `id` does not imply a `<label htmlFor>` exists
  anywhere; this is a false-negative source.
- The "nearby label" heuristic (form-labels.ts:30-32) joins
  `lines.slice(Math.max(0, i - 2), i + 1)` and tests for `<label` / `<Label`.
  A label that wraps its input (`<label>text <input/></label>`) does not have
  `<label` in the two preceding lines if the input is on the same line as the
  opening tag — wait, the slice includes `i` itself, so the same-line case
  works, but a label _after_ the input (also valid HTML) is missed. Worse, if
  two inputs share the same 3-line window, both inherit the single `<label`
  hit and neither is flagged.
- The skip list (form-labels.ts:27) covers `type="hidden"`, `type="submit"`,
  `type="button"` but not `type="image"` (which uses `alt`, not a label) or
  `type="reset"`. Inconsistent.

## Step 7 Types and dead surface

- `Violation.fix?: { from: string; to: string }` (types.ts:32) is declared but
  never emitted by any rule and never consumed by `formatResult`. Dead.
- `Rule.defaultSeverity` (types.ts:52) is only consulted when a rule's name is
  absent from `cfg.rules` — for the five current rules, all names are in
  `RuleConfig`, so `defaultSeverity` is read-only in the type but
  behaviorally inert for the configured ruleset (index.ts:84).
- `DesignCheckConfig.tokens` (types.ts:19-22): `spacing?` and `colors?` are
  declared but, as established in Step 2, never read. Dead.
- `DesignCheckConfig.include` (types.ts:17): declared, populated by
  `DEFAULT_CONFIG.include`, but never enforced. Dead path.
- `Severity` is exported from both `types.ts:5` and re-exported via
  `index.ts:142`. The re-export is fine but worth noting for downstream
  import audits.

These are not blocking but they mislead users: a consumer who sets
`tokens: { colors: { ... } }` or `include: ["**/*.vue"]` will believe they
have configured the tool when in fact nothing changed.

## Step 8 Tests

There is no test directory `packages/ax-code/test/design-check/` and no test
file under `packages/ax-code/test/` references `runDesignCheck`,
`no-hardcoded-colors`, `missing-alt-text`, or any other design-check symbol
(grep returned zero hits). The MODULE-AUDIT.md "Tests" section lists six
files (`release-check.test.ts`, `upgrade-check-view-model.test.ts`,
`check-policy.test.ts`, `check-bare-json-parse.test.ts`,
`check-no-effect-solid-in-v4.test.ts`, `check-tui-layering.test.ts`) but
these are unrelated `check-*` / release-check tests — none of them exercise
this module.

Concretely untested: the per-rule regexes (every false-positive / false-negative
described in Steps 5 and 6 is unguarded), the config merge at index.ts:57, the
severity-resolution branch at index.ts:84-89, the file-walk ignore matching
at index.ts:39, and the silent-error swallow paths at index.ts:37/63/78. For
a tool whose output drives `process.exitCode = 1` (design-check.ts:53), this
is a meaningful gap: a regression in any of those branches would ship green.

## Step 9 Verification and exit

Evidence collected this run: read all eight source files in
`packages/ax-code/src/design-check/`, read the consumer at
`packages/ax-code/src/cli/cmd/design-check.ts`, read
`docs/module-quality-audit/modules/design-check/MODULE-AUDIT.md`, and grepped
`packages/ax-code/src` plus `packages/ax-code/test` for `design-check`,
`runDesignCheck`, `cfg.tokens`, and `from ".*design-check"` to confirm the
usage and dead-config claims.

Severity rollup: no Critical findings accepted. The strongest issues are HIGH:

- Silent error swallowing at `index.ts:37`, `index.ts:63`, `index.ts:78` — a
  lint tool that hides unreadable files is misleading.
- Documented config knobs (`include`, `tokens`) are not enforced
  (`index.ts:56-70`, `types.ts:17-22`), so user configuration is silently
  ignored.
- No severity validation; invalid `--rule x=y` produces inconsistent
  summary-vs-detail output (`index.ts:84-99`, `design-check.ts:30-39`).

MEDIUM: per-rule false positives / false negatives in colors, spacing,
inline-styles, alt-text, form-labels (Steps 5-6). LOW: dead fields
`Violation.fix`, `tokens`, unused `defaultSeverity` for configured rules
(Step 7). LOW: no test coverage for the module (Step 8).

Because no Critical findings were accepted, the reverify.md gate is not
triggered for this unit. Recommended next steps for the module owner:
(1) validate severities and reject unknown values early in `runDesignCheck`;
(2) either honor `include` / `tokens` or remove them from the public type;
(3) replace the three silent `.catch(() => ...)` calls with skipped-file
reporting in the result summary;
(4) add a `packages/ax-code/test/design-check/` suite covering at minimum the
five rules' positive and negative cases.
