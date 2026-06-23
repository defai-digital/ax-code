# Bugs — Index

This folder holds confirmed, suspected, and false-positive bug reports for `ax-code`. Each report
is a single `.md` file; this file is the organizational index.

**Maintenance rule:** When a bug is resolved or refuted, add a `## Closure` section to its report,
move the file to `ax-internal/archive/bugs/`, and update this index. Keep only open reports in
`ax-internal/bugs/`.

**Last reviewed:** 2026-06-22

---

## Open Reports

| Report | Disposition | Filed at |
| --- | --- | --- |
| None. | — | — |

---

## Resolved / Closed (archived)

| Report | Disposition | Archived at |
| --- | --- | --- |
| TUI launch route (--session/--prompt) is resolved then discarded (MEDIUM) | resolved — already fixed before re-check (`872678b17` consumes the route, `3f7c13cec` wires auto-resume); dead `eventsource-stream` dep and "triggereded" typo also already fixed; `cargo test -p ax-code-tui` 62 pass incl. `acceptance_runner_route_auto_resumes_recent_session` | `archive/bugs/tui-launch-route-discarded.md` |
| LLM Profile Lookup Regression (HIGH) | false_positive — already fixed by commit 9e90d959 before re-check; all 4 flagged assertions pass | `archive/bugs/llm-profile-lookup-regression.md` |
| .internal → ax-internal Rename Over-Replacement (HIGH) | confirmed — 3 defects (broken regex + 2 mangled hostnames); fixed in same session; typecheck + release-check tests pass | `archive/bugs/internal-rename-over-replacement.md` |
