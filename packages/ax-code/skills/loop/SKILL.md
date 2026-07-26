---
name: loop
description: Run a prompt or slash command on a recurring interval (e.g. /loop 5m /foo, defaults to 10m).
agent: build
argument-hint: <interval> <prompt or /command>
---

Set up a recurring execution loop for the request in $ARGUMENTS.

## Parsing

Parse $ARGUMENTS as: `[interval] <prompt or /command>`

- Interval format: number + unit (`s`, `m`, `h`). Examples: `30s`, `5m`, `1h`.
- If no interval is specified, default to `10m`.
- The remainder is the prompt or slash command to execute each tick.

## Execution

Use the `/loop` command infrastructure to start the recurring execution:

1. Parse the interval into milliseconds.
2. Submit the recurring loop with the parsed interval and prompt.
3. Confirm to the user: what will run, how often, and how to stop it.

## Examples

- `/loop 5m check if the deploy finished` — every 5 minutes, check deploy status.
- `/loop 30s /verify` — every 30 seconds, run the verify skill.
- `/loop check the test output` — every 10 minutes (default), check test output.

## Constraints

- Maximum 500 runs per loop (hard ceiling).
- A tick that fires while the session is busy is skipped (not queued).
- Loops are in-memory and do not survive a restart.
- To stop: the user can end the session or the loop auto-stops after 500 runs.
