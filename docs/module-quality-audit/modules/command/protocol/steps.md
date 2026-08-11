# Nine-step review protocol — `command`

This is the source-backed review for slug `command`. The primary implementation
surface is `packages/ax-code/src/command/file-command.ts` together with
`packages/ax-code/src/command/index.ts`; related loaders, execution paths, API
exposure, and focused tests were also inspected.

## Step 1 Scope and public surface

`FileCommand` owns compatibility-file schemas, parsing, discovery, and portable
command names (`packages/ax-code/src/command/file-command.ts:8-35`,
`:51-58`, `:130-151`, `:210-215`). `Command` owns the merged runtime catalog,
event schema, builtin definitions, and public lookup/list operations
(`packages/ax-code/src/command/index.ts:24-74`, `:116-132`, `:388-395`). This
matches the two-file inventory recorded in
`docs/module-quality-audit/modules/command/MODULE-AUDIT.md:22-27`. Templates are
static inputs to those registrations rather than independent control-flow
modules, so the review followed their consumers instead of treating each text
asset as another source component.

## Step 2 Trust boundaries and security controls

File-backed command bodies can cross from project or user directories into a
prompt, but `FileCommand.parse` detects shell interpolation and always emits
`allowShell: false` (`packages/ax-code/src/command/file-command.ts:98-126`). The
execution layer honors that flag before running any interpolation
(`packages/ax-code/src/session/prompt-command-template.ts:49-58`). MCP prompt
content is labeled untrusted and truncated
(`packages/ax-code/src/command/index.ts:104-114`), while execution asks the MCP
prompt permission before resolving the template
(`packages/ax-code/src/session/prompt-command-setup.ts:37-53`, `:67-71`). One
security gap remains: compatibility discovery follows symbolic links
(`packages/ax-code/src/command/file-command.ts:179-200`) without checking the
resolved target stays under its root. The `.ax-code` loader demonstrates the
stronger intended pattern by applying `realpath` plus `Filesystem.contains`
(`packages/ax-code/src/config/config-impl.ts:949-972`). A repository-controlled
`.agents`, `.opencode`, or `.claude` symlink can therefore make discovery read a
Markdown file outside that compatibility root.

## Step 3 Correctness and precedence

Parse failures are propagated except for files that disappear during the scan,
which are deliberately ignored (`packages/ax-code/src/command/file-command.ts:130-149`,
`:217-220`). The material correctness concern is duplicate-name precedence:
discovery sorts by command name and then absolute location
(`packages/ax-code/src/command/file-command.ts:151-176`), after which the merge
loop retains the first non-overridable entry
(`packages/ax-code/src/command/index.ts:313-333`). Thus a project and global
compatibility command with the same name are selected by lexicographic path,
not explicit scope precedence. This is especially visible for `commit` and
`pr`, whose builtins are documented to yield to authored commands
(`packages/ax-code/src/command/index.ts:76-85`). Config commands are installed
unconditionally first (`:292-311`), MCP prompts overwrite names unconditionally
later (`:335-362`), and skills use the guard (`:364-380`), so precedence policy
is split across three different mechanisms.

## Step 4 Performance and resource behavior

Catalog construction is cached in instance state
(`packages/ax-code/src/command/index.ts:132-135`), and subsequent `get`/`list`
calls reuse that catalog (`:388-395`). Discovery scans each root serially, then
parses all matches in a root with an unbounded `Promise.all`
(`packages/ax-code/src/command/file-command.ts:159-175`, `:179-200`). Normal
command counts make this inexpensive, but a compatibility tree containing many
Markdown files can create a burst of concurrent reads; a modest concurrency cap
would give more predictable descriptor and memory use. The final sort is
`O(n log n)` (`:176`) and is not itself concerning, though it currently doubles
as accidental precedence logic as noted in Step 3.

## Step 5 Design and ownership

The parser boundary is usefully shared: `.ax-code` loading calls
`FileCommand.parse` and copies its workflow, warnings, source, scope, and shell
policy (`packages/ax-code/src/config/config-impl.ts:963-1001`), while compatibility
roots call `parseFile` (`packages/ax-code/src/command/file-command.ts:179-200`).
The merged `Command.Info` schema then supplies one representation to the server
and execution paths (`packages/ax-code/src/command/index.ts:42-74`). The weak
point is that precedence ownership lives implicitly inside mutation order in
the large state initializer (`:137-386`) instead of a named comparator or merge
function. That design accounts for the scope-order defect in Step 3 and makes
new source types easy to insert with unintended shadowing behavior.

## Step 6 Error handling and hygiene

The catches in the reviewed module are purposeful rather than silent: markdown
read errors only become `undefined` when the cause is ENOENT
(`packages/ax-code/src/command/file-command.ts:136-140`, `:217-220`), and glob
errors receive the same narrow handling (`:180-189`). Invalid frontmatter fields
produce structured warnings (`:59-96`), including unknown keys and malformed
model formatting. `parse` is declared async despite having no await (`:51-58`),
which is harmless and keeps it interchangeable with file parsing, but the
builtin registration block (`packages/ax-code/src/command/index.ts:137-290`)
contains substantial repetitive object construction. A small constructor could
reduce future metadata drift without changing behavior.

## Step 7 Test coverage and gaps

Focused execution passed 12 tests across the two direct suites. The discovery
suite checks project metadata and shell disabling
(`packages/ax-code/test/command/file-command.test.ts:23-60`), malformed and
unreadable file propagation (`:63-120`), global shell-interpolation inertness
(`:138-179`), and protection of `review` from a `.agents` override
(`:182-211`). Placeholder ordering and MCP untrusted labeling are asserted in
`packages/ax-code/test/command/hints.test.ts:4-31`. Missing cases are duplicate
names across user/project scopes, a symlink escaping a compatibility command
root, builtin collision through the separate `.ax-code` config path, and MCP
name collision. Those omissions correspond directly to the branches at
`packages/ax-code/src/command/index.ts:292-380` and the symlink-enabled scan at
`packages/ax-code/src/command/file-command.ts:179-200`.

## Step 8 Registered findings reconciliation

No `findings/` directory exists for this unit, and the audit register explicitly
contains `_none accepted_`
(`docs/module-quality-audit/modules/command/MODULE-AUDIT.md:72-76`). Consequently
there is no registered Critical item and no `reverify.md` is created. The
symlink-containment and path-sorted precedence risks discovered in Steps 2 and 3
are retained here as review observations; the user's exact-artifact constraint
precludes creating new finding files. The audit's existing register-to-files
check remains marked consistent (`docs/module-quality-audit/modules/command/MODULE-AUDIT.md:86-90`).

## Step 9 Verification and handoff

`AX_TEST_FILES=test/command/file-command.test.ts,test/command/hints.test.ts pnpm
exec vitest run` completed with 2 files and 12 tests passing, and `pnpm --dir
packages/ax-code run typecheck` completed successfully. These validate the
public functions exposed at `packages/ax-code/src/command/index.ts:87-114` and
`:388-395` plus the file pipeline at
`packages/ax-code/src/command/file-command.ts:51-215`. Per the requested lane
assignment, the generated protocol names `codex-sol` as reviewer and
`ax-code-glm` as verifier. The pre-existing audit header currently records the
inverse pairing (`docs/module-quality-audit/modules/command/MODULE-AUDIT.md:11-16`);
it was not edited because this task limits output to the protocol artifacts.
