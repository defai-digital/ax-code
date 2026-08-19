---
name: queue-worker
description: Change a queue, worker, or async consumer safely. Use when touching jobs, retries, idempotency, outbox/inbox, SQS/Kafka/Redis/Sidekiq/Bull, or "exactly once" delivery.
agent: devops
argument-hint: <worker or queue change>
---

Handle the async change in $ARGUMENTS. A passing unit test does not prove duplicate delivery is safe.

## Phase 1 - Inventory

- Broker and library the repo already uses. Do not add a new queue product.
- Producer, payload schema, consumer, retry/backoff, DLQ/poison handling.
- What "success" means: the side effect (DB row, email, webhook) and whether it is idempotent.

## Phase 2 - Invariants

State, with code evidence:

- **At-least-once** is the default. Design for duplicates.
- Idempotency key and where it is stored.
- Retry/backoff and max attempts. What happens after the last failure.
- Ordering: required or not. If required, what partitions/keys provide it.
- Transaction boundary: write + enqueue must not diverge (outbox/inbox if the repo has one).

## Phase 3 - Change

- Make the handler safe to run twice with the same payload.
- Do not catch-and-swallow errors that should retry.
- Do not add a fire-and-forget side effect without a failure path.

## Phase 4 - Verify

- Add or run a test that delivers the same message twice, or document why that test cannot exist yet.
- Report: handler, idempotency, retry/DLQ, and what was not tested (ordering, poison, broker failover).

## Constraints

- Do not purge a shared queue.
- Do not claim exactly-once unless the repo already implements a proven outbox + unique constraint.
