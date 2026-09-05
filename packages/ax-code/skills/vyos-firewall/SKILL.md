---
name: vyos-firewall
description: Administer a VyOS router or firewall over SSH using config-mode staging, mandatory commit-confirm commits with automatic rollback, and pre-change configuration capture. Use when the user asks to change VyOS firewall, NAT, interface, or routing configuration.
agent: cloudops
argument-hint: <change to make, e.g. "add a firewall rule allowing tcp/8443 from 10.0.0.0/8">
---

Apply the VyOS change in $ARGUMENTS over SSH without risking a management-plane lockout.

## Phase 1 - Capture the current configuration

- Before any change, run `show configuration commands` (or `show config`) over the current session and save the output to a file named with the date and target host.
- Suggest committing that file to git (or copying it off-device) so there is an auditable pre-change baseline.

## Phase 2 - Stage edits in config mode

- Enter `configure`. Make the smallest set of `set`/`delete` statements that implements the change.
- Run `compare` and show its full output to the user before committing. No hidden or partial diffs.

## Phase 3 - Commit with automatic rollback (mandatory)

- EVERY commit MUST be `commit-confirm <minutes>` (suggest 5-10 minutes), never a bare `commit`. If the session or the device is interrupted, the change auto-rolls back when the timer expires.
- After the commit-confirm, run reachability and health checks from the session and from a second path where possible: ping the gateway, verify SSH to the next hop, check that expected services answer.
- Only run `confirm` after those checks pass. If any check fails, let the timer expire (auto-rollback) instead of confirming.

## Phase 4 - Validate and persist

- Verify the intended behavior end to end (traffic flows, NAT translations, firewall counters incrementing as expected).
- Only after the confirmed commit is validated, run `save` to persist the boot configuration. Never `save` an unvalidated commit.

## Phase 5 - Rollback recipe

- `commit-confirm` timeout auto-rolls back if not confirmed.
- For an already-confirmed bad change: `rollback <N>` to revision N (see `show system commit`), verify, then re-commit with `commit-confirm`.
- For a lost session: reconnect via out-of-band access and roll back to the captured baseline file.

## Constraints

- Never run a bare `commit` on a remote device; every commit is `commit-confirm <minutes>`.
- Never `save` the boot config until the confirmed commit is validated.
- Warn when a change could cut the very session being used (interface address, firewall rule, routing change on the management path). Require the user to confirm out-of-band access (console, IPMI, second NIC) before proceeding.
- Never run `save` without the user asking for persistence.
