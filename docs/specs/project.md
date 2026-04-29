# Project and Session API

Status: Active
Scope: current-state
Last reviewed: 2026-04-28
Owner: ax-code runtime

This document describes the current HTTP API shape for projects and sessions exposed by `ax-code serve`. The authoritative source is the OpenAPI snapshot at `packages/sdk/openapi.json`.

## Project Routes

```
GET    /project                   → Project[]           List all known projects
GET    /project/current           → Project             Get the currently active project
POST   /project/git/init          → Project             Initialize a git repo in the current project directory
PATCH  /project/:projectID        → Project             Update project properties (name, icon, commands)
```

## Session Routes

```
GET    /session                   → Session[]           List sessions (query: directory, roots, start, search, limit)
GET    /session/status            → Record<id, Status>  Get live status for all sessions
GET    /session/:sessionID        → Session             Get a session
GET    /session/:sessionID/children → Session[]         Get child sessions forked from this session
POST   /session                   → Session             Create a session
DELETE /session/:sessionID                              Delete a session
PATCH  /session/:sessionID        → Session             Update session metadata

POST   /session/:sessionID/init                         Initialize a session
POST   /session/:sessionID/fork   → Session             Fork a session
POST   /session/:sessionID/abort                        Abort the running session loop
POST   /session/:sessionID/share                        Share a session
DELETE /session/:sessionID/share                        Unshare a session
POST   /session/:sessionID/summarize                    Summarize a session
POST   /session/:sessionID/revert → Session             Revert to a previous session state
POST   /session/:sessionID/unrevert → Session           Undo a revert
```

## Message and Part Routes

```
GET    /session/:sessionID/messages → Message[]         Get all messages in a session
GET    /session/:sessionID/message/:messageID → Message Get a specific message
DELETE /session/:sessionID/message/:messageID           Delete a message
DELETE /session/:sessionID/part/:partID                 Delete a message part
PATCH  /session/:sessionID/part/:partID → Part          Update a message part
```

## Prompt and Command Routes

```
POST   /session/:sessionID/prompt          → Message    Send a prompt (sync)
POST   /session/:sessionID/prompt-async    → 202        Send a prompt (async)
POST   /session/:sessionID/command         → Message    Run a slash command (sync)
POST   /session/:sessionID/command-async   → 202        Run a slash command (async)
POST   /session/:sessionID/shell           → Message    Run a shell command in session context (sync)
POST   /session/:sessionID/shell-async     → 202        Run a shell command (async)
```

## Permission Routes

```
POST   /session/:sessionID/permission/:permissionID     Respond to a pending permission prompt
```

## Analysis Routes

```
GET    /session/:sessionID/branch/rank     → BranchRank  Compare branches and recommend the strongest
GET    /session/:sessionID/dre             → DreResult   Decision risk evaluation for the session
GET    /session/:sessionID/graph           → Graph       Code graph snapshot for the session
GET    /session/:sessionID/risk            → RiskResult  Risk signals for the session
GET    /session/:sessionID/semantic-diff   → SemanticDiff Semantic diff between session states
GET    /session/:sessionID/rollback-points → Point[]    Available rollback checkpoints
GET    /session/:sessionID/compare         → Comparison  Compare two session states
GET    /session/:sessionID/todo            → Todo[]      Outstanding todos inferred from session
GET    /session/:sessionID/diff            → Diff        File diff for the session
```

## Notes

- The session model is flat. Sessions are not nested under projects in the URL structure — project association is carried in the session record itself.
- The async prompt/command/shell routes return HTTP 202 immediately; the session loop runs detached. Subscribe to `/session/:sessionID/status` or the event stream for completion.
- For generated cross-language clients, see [HTTP and OpenAPI SDKs](../sdk-http-openapi.md).
