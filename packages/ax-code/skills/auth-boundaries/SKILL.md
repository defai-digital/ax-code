---
name: auth-boundaries
description: Review or change authentication, authorization, sessions, or tenant isolation. Use when touching login, tokens, cookies, RBAC, multi-tenant filters, or "is this endpoint public."
agent: security
argument-hint: <auth change or question>
---

Treat $ARGUMENTS as a trust-boundary change.

## Phase 1 - Map the boundary

- How identity is established (session, JWT, API key, mTLS).
- Where authorization is enforced (middleware, per-handler, row-level).
- Tenant/org isolation: the column, claim, or workspace id that must be present on every query.

## Phase 2 - Check the usual failures

With file evidence, look for:

- Missing auth on a new or sibling route.
- IDOR: object id accepted without an ownership check.
- Token/cookie lifetime, refresh, logout, and CSRF on cookie sessions.
- Secret handling (keys in repo, tokens in logs).
- Confused deputy / internal endpoints exposed.

## Phase 3 - Change

- Enforce authorization next to the resource, not only at the UI.
- Add a negative test: unauthenticated and wrong-tenant callers must fail.
- Do not weaken existing checks to make a happy-path test pass.

## Phase 4 - Verify

- Run the auth/session tests that exist. If none exist for this path, add the smallest negative test before claiming done.
- Report: boundary, checks added, tests run, residual risk.

## Constraints

- Do not log tokens or session secrets.
- Do not rotate production secrets unless the user asked and a runbook exists.
