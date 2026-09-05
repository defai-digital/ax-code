---
name: cloud-ops-aws
description: Operate AWS resources (EC2, S3, RDS, IAM, Lambda) with read-only inventory first, a confirm-before-delete plan, and an IaC rollback recipe. Use when the user asks to inspect, change, or clean up AWS infrastructure.
agent: cloudops
argument-hint: <operation and target resources, e.g. "resize the rds instance in prod">
---

Handle the AWS operation in $ARGUMENTS as a reversible change, not a sequence of CLI one-liners.

## Phase 1 - Identity and account

- Run `aws sts get-caller-identity` and state the account ID, ARN, and default region before anything else.
- Confirm the account is the intended one (dev vs staging vs production). If it is a production account and the user did not explicitly ask for production, stop.

## Phase 2 - Read-only inventory first

- Use only describe/list/get operations to build the inventory: `aws ec2 describe-instances`, `aws rds describe-db-instances`, `aws s3 ls`, `aws lambda list-functions`, `aws iam list-users`.
- Record IDs, names, state, tags, and dependencies of the target resources. Mutate nothing in this phase.

## Phase 3 - Plan (required before any delete/terminate)

- Write the exact command(s) to run, including region and resource IDs.
- List every resource each command affects, plus blast radius (attached volumes, security groups, DNS records, downstream consumers).
- For commands that support it, show the `--dry-run` or validation-mode output first.
- Present the exact command to the user and get explicit confirmation of that exact command before executing.

## Phase 4 - Execute

- Run the confirmed command only. Do not chain extra mutations that were not part of the plan.
- Verify the result with read-only calls (describe/get) and report the new state.

## Phase 5 - Rollback recipe

- State the rollback path before executing Phase 4, not after something breaks.
- Recreate deleted resources from IaC (Terraform, CloudFormation, CDK) by re-applying the last good state; drift the plan first.
- Restore data from snapshots or backups: RDS snapshots/PITR, EBS snapshots, S3 versioning.
- State what cannot be rolled back (irreversibly deleted unversioned objects, released Elastic IPs).

## Constraints

- Never inline credentials (`AWS_SECRET_ACCESS_KEY=...`) in commands; use the configured profile or instance role.
- Prefer `--dry-run` or validation mode whenever the operation supports it.
- Never touch production accounts without an explicit user ask for that account.
- Prefer MCP AWS tools over shell commands when they are configured.
