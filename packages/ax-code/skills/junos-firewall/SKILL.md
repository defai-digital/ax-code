---
name: junos-firewall
description: Administer a Juniper Junos firewall or router over SSH using a private/exclusive candidate config, mandatory commit confirmed commits with automatic rollback, and pre-change configuration capture. Use when the user asks to change Junos firewall filter, NAT, interface, or routing configuration.
agent: devops
argument-hint: <change to make, e.g. "add a firewall filter term allowing tcp/443 from the dmz">
---

Apply the Junos change in $ARGUMENTS over SSH without risking a management-plane lockout.

## Phase 1 - Capture the current configuration

- Before any change, run `show configuration | display set` over the current session and save the output to a file named with the date and target host.
- Suggest committing that file to git (or copying it off-device) so there is an auditable pre-change baseline.

## Phase 2 - Work on the candidate config

- Enter `configure private` (or `configure exclusive` when the change spans many statements) so other administrators are not blocked.
- Make the smallest set of `set`/`delete` statements that implements the change.
- Run `show | compare` and show its full output to the user before committing. No hidden or partial diffs.

## Phase 3 - Commit with automatic rollback (mandatory)

- Request explicit user confirmation of the diff before any commit.
- EVERY remote commit MUST be `commit confirmed <minutes>` (suggest 5-10 minutes), never a bare `commit`. Junos automatically rolls back the candidate if it is not confirmed before the timer expires.
- After the commit confirmed, run reachability and health checks from the session and from a second path where possible: ping the gateway, verify SSH to the next hop, check that expected services answer.
- Only run `commit check`-style verification and then `commit` (confirm) after those checks pass. If any check fails, let the timer expire (auto-rollback) instead of confirming.

## Phase 4 - Validate

- Verify the intended behavior end to end (traffic flows, firewall counters, NAT translations).
- Do not assume persistence work is needed beyond the commit; the candidate becomes the active config on confirm.

## Phase 5 - Rollback recipe

- `commit confirmed` timeout auto-rolls back if not confirmed.
- For an already-confirmed bad change: `rollback 0` restores the last committed config; numbered revisions (`show system commit`) are the audit trail. Roll back, verify, then re-commit with `commit confirmed`.
- For a lost session: reconnect via out-of-band access and load the captured baseline set file.

## Constraints

- Never run a bare `commit` on a remote device; every commit is `commit confirmed <minutes>`.
- Warn when a change could cut the very session being used (interface address, firewall filter, routing change on the management path). Require the user to confirm out-of-band access (console, management port, second routing instance) before proceeding.
- Never discard another administrator's uncommitted changes; use `configure private` by default.
