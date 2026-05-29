import { describe, expect, test } from "bun:test"
import { createCommandCenterViewModel } from "../src/projection/view-model"
import {
  getRuntimeConfig,
  isAppFeatureEnabled,
  runtimeNetworkScope,
  storeRuntimeConfigForReload,
} from "../src/runtime/config"
import {
  applyLiveRuntimeEvent,
  bootstrapLiveCommandCenterState,
  followLiveCommandCenterEvents,
  followLiveCommandCenterEventsWithReconnect,
  normalizeSkillOptions,
} from "../src/runtime/live"

describe("app live runtime", () => {
  test("defaults to fixture mode without injected backend config", () => {
    expect(getRuntimeConfig({ window: {} as Window })).toEqual({ mode: "fixture" })
  })

  test("supports explicit runtime feature policy for beta tool panes", () => {
    const config = getRuntimeConfig({
      window: {
        __AX_CODE_APP_CONFIG__: {
          mode: "live",
          baseUrl: "http://127.0.0.1:4096",
          features: { terminalPane: false, browserPane: true },
        },
      } as Window,
    })

    expect(config).toMatchObject({
      mode: "live",
      features: { terminalPane: false, browserPane: true },
    })
    expect(isAppFeatureEnabled(config, "terminalPane")).toBe(false)
    expect(isAppFeatureEnabled(config, "browserPane")).toBe(true)
    expect(isAppFeatureEnabled(config, "filePane")).toBe(true)
  })

  test("keeps desktop live runtime config across renderer reloads", () => {
    const storage = new Map<string, string>()
    const window = {
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    } as unknown as Window

    storeRuntimeConfigForReload(
      {
        mode: "live",
        baseUrl: "http://127.0.0.1:4555",
        headers: { Authorization: "Basic generated" },
        directory: "/workspace/ax-code",
        features: { terminalPane: true, browserPane: false, filePane: true },
        scheduledTaskExecution: { owner: "desktop-sidecar", stopsOnAppQuit: true },
      },
      { window },
    )
    delete window.__AX_CODE_APP_CONFIG__

    expect(getRuntimeConfig({ window })).toEqual({
      mode: "live",
      baseUrl: "http://127.0.0.1:4555",
      headers: { Authorization: "Basic generated" },
      directory: "/workspace/ax-code",
      features: { terminalPane: true, browserPane: false, filePane: true },
      scheduledTaskExecution: { owner: "desktop-sidecar", stopsOnAppQuit: true },
    })
  })

  test("classifies live backend network scope for local-first warnings", () => {
    expect(runtimeNetworkScope({ mode: "fixture" })).toBe("fixture")
    expect(runtimeNetworkScope({ mode: "live", baseUrl: "http://127.0.0.1:4096" })).toBe("loopback")
    expect(runtimeNetworkScope({ mode: "live", baseUrl: "http://localhost:4096" })).toBe("loopback")
    expect(runtimeNetworkScope({ mode: "live", baseUrl: "https://example.com" })).toBe("remote")
    expect(runtimeNetworkScope({ mode: "live", baseUrl: "not a url" })).toBe("invalid")
  })

  test("bootstraps read-only sessions from a live-compatible client", async () => {
    const evidenceParameters: unknown[] = []
    const state = await bootstrapLiveCommandCenterState({
      mode: "live",
      baseUrl: "http://127.0.0.1:4096",
      client: {
        client: {
          session: {
            list: async () => ({
              data: [
                {
                  id: "ses_live",
                  title: "Live backend session",
                  project: { name: "ax-code" },
                  branch: "feature/live",
                  updatedAt: "2026-05-28T19:00:00Z",
                },
              ],
            }),
            messages: async () => ({
              data: [
                {
                  info: {
                    id: "msg_user",
                    sessionID: "ses_live",
                    role: "user",
                    time: { created: 1_000 },
                  },
                  parts: [{ id: "part_user", messageID: "msg_user", type: "text", text: "Review this branch" }],
                },
                {
                  info: {
                    id: "msg_assistant",
                    sessionID: "ses_live",
                    role: "assistant",
                    time: { created: 1_100 },
                  },
                  parts: [
                    {
                      id: "part_assistant",
                      messageID: "msg_assistant",
                      type: "text",
                      text: "Branch review loaded from live history",
                    },
                  ],
                },
              ],
            }),
          },
          config: {
            get: async () => ({
              data: {
                permission: {
                  edit: "ask",
                  shell: {
                    "pnpm *": "allow",
                    "rm *": "deny",
                  },
                },
                experimental: {
                  autonomous_strict_permission: true,
                },
              },
            }),
            providers: async () => ({
              data: {
                providers: [
                  {
                    id: "openai",
                    name: "OpenAI",
                    source: "env",
                    models: [{ id: "gpt-5-codex", name: "gpt-5-codex" }],
                  },
                  {
                    id: "local",
                    name: "Local",
                    source: "localhost",
                    models: [],
                    reason: "No local models are configured",
                  },
                ],
                default: { openai: "gpt-5-codex" },
              },
            }),
          },
          mcp: {
            status: async () => ({
              data: {
                github: { status: "connected" },
                figma: { status: "needs_auth" },
                old: { status: "disabled" },
              },
            }),
          },
          lsp: {
            status: async () => ({
              data: [
                { id: "ts", name: "typescript", root: ".", status: "connected" },
                { id: "rust", name: "rust-analyzer", root: ".", status: "error" },
              ],
            }),
          },
          debugEngine: {
            pendingPlans: async () => ({
              data: {
                count: 2,
                plans: [],
                toolCount: 6,
                graph: {
                  nodeCount: 42,
                  edgeCount: 72,
                  lastIndexedAt: 1_780_000_000_000,
                  state: "indexing",
                  completed: 7,
                  total: 10,
                  error: null,
                },
              },
            }),
          },
          agent: {
            agents: async () => ({
              data: [
                {
                  id: "build",
                  label: "Build",
                  mode: "primary",
                },
              ],
            }),
          },
          app: {
            skills: async () => ({
              data: [
                {
                  name: "debug-n-fix",
                  description: "Debug and repair a failing workflow",
                  location: "/bundle/skills/debug-n-fix/SKILL.md",
                  builtin: true,
                  argumentHint: "[issue]",
                },
                {
                  name: "release-review",
                  description: "Review release readiness",
                  location: "/workspace/ax-code/.ax-code/skill/release-review/SKILL.md",
                  standardIssues: ["missing compatibility metadata"],
                },
              ],
            }),
          },
          worktree: {
            list: async () => ({
              data: [
                "/workspace/ax-code",
                {
                  directory: "/workspace/.ax-code/worktrees/wt-live",
                  name: "wt-live",
                  branch: "ax-code/wt-live",
                },
              ],
            }),
          },
          pty: {
            list: async () => ({
              data: [
                {
                  id: "pty_live",
                  title: "Live terminal",
                  command: "zsh",
                  args: [],
                  cwd: "/workspace/ax-code",
                  status: "running",
                  pid: 1234,
                },
              ],
            }),
          },
        },
        taskQueue: {
          list: async () => [
            {
              id: "tsk_live",
              projectID: "project_live",
              directory: "/workspace/ax-code",
              worktree: "main",
              sessionID: "ses_live",
              kind: "prompt",
              status: "queued",
              priority: 10,
              position: 0,
              title: "Queue from backend",
              agent: "build",
              model: { providerID: "test", modelID: "test-model" },
              payload: {},
              time: { created: 1_800, started: 1_900, completed: 2_400 },
            },
          ],
        },
        scheduledTask: {
          list: async () => [
            {
              id: "sch_live",
              projectID: "project_live",
              directory: "/workspace/ax-code",
              title: "Daily branch review",
              prompt: "Review the branch",
              schedule: { type: "daily", time: "09:00" },
              status: "active",
              agent: "review",
              lastQueueID: "tsk_live",
              lastSessionID: "ses_live",
              lastDurationMs: 500,
              error: "Last automation run failed verification",
              nextRunAt: 2_000,
              lastRunAt: 1_900,
              time: { created: 1_000 },
            },
          ],
        },
        sessionEvidence: {
          load: async (sessionID, parameters) => {
            evidenceParameters.push(parameters)
            return {
              sessionID,
              risk: {
                assessment: {
                  level: "HIGH",
                  score: 71,
                  confidence: 0.82,
                  readiness: "needs_validation",
                  summary: "High risk until review evidence is checked.",
                },
                drivers: ["broad app shell"],
                findings: [{ findingId: "finding_1", severity: "high", summary: "Bridge command needs review" }],
                envelopes: [{ envelopeId: "env_1", status: "passed", command: "pnpm --dir packages/app run test" }],
                reviewResults: [{ reviewId: "rev_1", decision: "needs_changes", summary: "Review before packaging" }],
                decisionHints: {
                  hints: [{ id: "hint_1", category: "missing_verification", title: "Run review verification" }],
                },
              },
              semantic: {
                headline: "Changes command-center shell",
                risk: "high",
                files: 3,
                additions: 120,
                deletions: 8,
                changes: [{ file: "packages/app/src/App.tsx", summary: "Adds review panel", risk: "high" }],
              },
              dre: {
                detail: {
                  decision: "Validate before packaging",
                  readiness: "needs_validation",
                },
                timeline: [{ text: "Risk loaded" }],
              },
              branchRank: {
                currentID: sessionID,
                recommendedID: "ses_live",
                confidence: 0.91,
                reasons: ["Best validation signal"],
                recommended: {
                  id: "ses_live",
                  title: "Live backend session",
                },
                items: [
                  {
                    id: "ses_live",
                    title: "Live backend session",
                    current: true,
                    recommended: true,
                    headline: "Ready branch",
                    risk: { level: "LOW", score: 18 },
                    decision: { total: 92 },
                  },
                ],
              },
              rollback: [
                {
                  step: 4,
                  messageID: "msg_assistant",
                  partID: "part_step",
                  duration: 1200,
                  tokens: { input: 200, output: 50 },
                  tools: ["apply_patch"],
                  kinds: ["apply_patch"],
                },
              ],
              errors: [],
            }
          },
        },
      },
    })

    expect(state.selectedSessionID).toBe("ses_live")
    expect(state.projection.session[0]).toMatchObject({
      id: "ses_live",
      title: "Live backend session",
      project: "ax-code",
      worktree: "feature/live",
    })
    expect(state.projection.message.ses_live).toHaveLength(2)
    expect(state.projection.part["msg_assistant"]?.[0]).toMatchObject({
      id: "part_assistant",
      text: "Branch review loaded from live history",
    })
    expect(
      createCommandCenterViewModel(state).messages.find((message) => message.id === "msg_assistant"),
    ).toMatchObject({
      id: "msg_assistant",
      text: "Branch review loaded from live history",
    })
    expect(state.queue[0]).toMatchObject({
      id: "tsk_live",
      project: "project_live",
      sessionID: "ses_live",
      title: "Queue from backend",
      status: "queued",
      worktree: "main",
      agent: "build",
    })
    expect(state.evidence.ses_live?.risk).toMatchObject({ level: "HIGH", score: 71 })
    expect(state.evidence.ses_live?.semantic?.headline).toBe("Changes command-center shell")
    expect(state.evidence.ses_live?.branchRank).toMatchObject({
      recommendedID: "ses_live",
      recommendedTitle: "Live backend session",
      confidence: 0.91,
      reasons: ["Best validation signal"],
    })
    expect(state.evidence.ses_live?.branchRank?.items[0]).toMatchObject({
      id: "ses_live",
      recommended: true,
      riskLevel: "LOW",
      decisionScore: 92,
    })
    expect(state.evidence.ses_live?.rollbackPoints[0]?.step).toBe(4)
    expect(state.evidence.ses_live?.rollbackPoints[0]?.messageID).toBe("msg_assistant")
    expect(state.evidence.ses_live?.rollbackPoints[0]?.tokens).toEqual({ input: 200, output: 50 })
    expect(state.evidence.ses_live?.artifactCounts.findings).toBe(1)
    expect(state.evidence.ses_live?.artifactCounts.reviewResults).toBe(1)
    expect(state.evidence.ses_live?.artifactPreviews.findings[0]).toMatchObject({
      id: "finding_1",
      title: "Bridge command needs review",
      status: "high",
    })
    expect(state.evidence.ses_live?.artifactPreviews.verificationEnvelopes[0]).toMatchObject({
      id: "env_1",
      status: "passed",
    })
    expect(state.catalog.agents[0]).toMatchObject({ id: "build", label: "Build" })
    expect(state.catalog.skills).toEqual([
      {
        name: "debug-n-fix",
        description: "Debug and repair a failing workflow",
        location: "/bundle/skills/debug-n-fix/SKILL.md",
        argumentHint: "[issue]",
        builtin: true,
        status: "ok",
        issues: [],
      },
      {
        name: "release-review",
        description: "Review release readiness",
        location: "/workspace/ax-code/.ax-code/skill/release-review/SKILL.md",
        status: "warn",
        issues: ["missing compatibility metadata"],
      },
    ])
    expect(state.catalog.providers[0]).toMatchObject({
      id: "openai",
      label: "OpenAI",
      source: "env",
      modelCount: 1,
      defaultModelID: "gpt-5-codex",
      status: "available",
    })
    expect(state.catalog.providers[1]).toMatchObject({
      id: "local",
      status: "no_models",
      reason: "No local models are configured",
    })
    expect(state.catalog.models[0]).toMatchObject({ providerID: "openai", modelID: "gpt-5-codex" })
    expect(state.catalog.mcp).toMatchObject({ total: 3, connected: 1, disabled: 1, needsAuth: 1 })
    expect(state.catalog.lsp).toMatchObject({ total: 2, connected: 1, error: 1 })
    expect(state.catalog.codeIndex).toMatchObject({
      pendingPlans: 2,
      toolCount: 6,
      nodeCount: 42,
      state: "indexing",
      completed: 7,
      total: 10,
    })
    expect(state.catalog.permission).toMatchObject({
      totalRules: 3,
      allow: 1,
      ask: 1,
      deny: 1,
      strictUnknown: true,
    })
    expect(evidenceParameters).toEqual([{ includeBranchRank: true }])
    expect(state.worktrees.map((worktree) => worktree.name)).toContain("wt-live")
    expect(state.worktrees.find((worktree) => worktree.name === "wt-live")?.branch).toBe("ax-code/wt-live")
    expect(state.terminals[0]).toMatchObject({ id: "pty_live", title: "Live terminal", status: "running" })
    expect(state.queue[0]).toMatchObject({ id: "tsk_live", startedAt: 1_900, completedAt: 2_400 })
    expect(state.scheduledTasks[0]).toMatchObject({
      id: "sch_live",
      title: "Daily branch review",
      status: "active",
      lastQueueID: "tsk_live",
      lastSessionID: "ses_live",
      lastDurationMs: 500,
      error: "Last automation run failed verification",
    })
  })

  test("normalizes wrapped skill catalog responses without exposing content", () => {
    expect(
      normalizeSkillOptions({
        skills: [
          {
            name: "review",
            description: "Review current branch",
            location: "/workspace/.ax-code/skill/review/SKILL.md",
            content: "# ignored",
            standardIssues: ["missing license"],
          },
          { description: "missing name" },
        ],
      }),
    ).toEqual([
      {
        name: "review",
        description: "Review current branch",
        location: "/workspace/.ax-code/skill/review/SKILL.md",
        status: "warn",
        issues: ["missing license"],
      },
    ])
  })

  test("applies live headless events and ignores unsupported events", async () => {
    const state = await bootstrapLiveCommandCenterState({
      mode: "live",
      baseUrl: "http://127.0.0.1:4096",
      client: {
        client: {
          session: {
            list: async () => ({ data: [] }),
          },
        },
      },
    })

    expect(applyLiveRuntimeEvent(state, { type: "project.updated", properties: {} })).toBe(false)
    expect(
      applyLiveRuntimeEvent(state, {
        type: "session.created",
        properties: {
          info: {
            id: "ses_event",
            title: "Created from stream",
            project: "ax-code",
            updatedAt: 1,
          },
        },
      }),
    ).toBe(true)
    expect(state.projection.session[0]?.id).toBe("ses_event")
  })

  test("applies task queue events to live state", async () => {
    const state = await bootstrapLiveCommandCenterState({
      mode: "live",
      baseUrl: "http://127.0.0.1:4096",
      client: {
        client: {
          session: {
            list: async () => ({ data: [] }),
          },
        },
      },
    })

    expect(
      applyLiveRuntimeEvent(state, {
        type: "task.queue.created",
        properties: {
          item: {
            id: "tsk_event",
            projectID: "project_live",
            directory: "/workspace/ax-code",
            worktree: "wt-event",
            kind: "review",
            status: "failed",
            priority: 0,
            position: 0,
            title: "Review queued branch",
            error: "Task interrupted by backend restart; inspect output and retry when safe.",
            payload: {},
            time: { created: 2_000 },
          },
        },
      }),
    ).toBe(true)
    expect(state.queue[0]).toMatchObject({
      id: "tsk_event",
      status: "failed",
      worktree: "wt-event",
      error: "Task interrupted by backend restart; inspect output and retry when safe.",
    })

    expect(
      applyLiveRuntimeEvent(state, {
        type: "task.queue.deleted",
        properties: { id: "tsk_event", projectID: "project_live" },
      }),
    ).toBe(true)
    expect(state.queue).toHaveLength(0)
  })

  test("applies scheduled task events to live state", async () => {
    const state = await bootstrapLiveCommandCenterState({
      mode: "live",
      baseUrl: "http://127.0.0.1:4096",
      client: {
        client: {
          session: {
            list: async () => ({ data: [] }),
          },
        },
      },
    })

    expect(
      applyLiveRuntimeEvent(state, {
        type: "scheduled.task.created",
        properties: {
          task: {
            id: "sch_event",
            projectID: "project_live",
            directory: "/workspace/ax-code",
            title: "Cron review",
            prompt: "Review on schedule",
            schedule: { type: "cron", expression: "0 9 * * *" },
            status: "active",
            nextRunAt: 2_000,
            time: { created: 1_000 },
          },
        },
      }),
    ).toBe(true)
    expect(state.scheduledTasks[0]).toMatchObject({ id: "sch_event", status: "active" })

    expect(
      applyLiveRuntimeEvent(state, {
        type: "scheduled.task.deleted",
        properties: { id: "sch_event", projectID: "project_live" },
      }),
    ).toBe(true)
    expect(state.scheduledTasks).toHaveLength(0)
  })

  test("follows live event streams into the command-center projection", async () => {
    const state = await bootstrapLiveCommandCenterState({
      mode: "live",
      baseUrl: "http://127.0.0.1:4096",
      client: {
        client: {
          session: {
            list: async () => ({ data: [] }),
          },
        },
      },
    })
    const seen: boolean[] = []

    const applied = await followLiveCommandCenterEvents(
      state,
      {
        subscribe: async function* () {
          yield { type: "server.heartbeat", properties: {} }
          yield {
            type: "session.created",
            properties: {
              info: {
                id: "ses_stream",
                title: "Streamed session",
                project: "ax-code",
                updatedAt: 2,
              },
            },
          }
          yield { type: "project.updated", properties: {} }
        },
      },
      {
        onEvent: (_event, eventApplied) => seen.push(eventApplied),
      },
    )

    expect(applied).toBe(2)
    expect(seen).toEqual([true, true, false])
    expect(state.projection.session[0]?.id).toBe("ses_stream")
  })

  test("surfaces bootstrap reload effects from backend dispose events", async () => {
    const state = await bootstrapLiveCommandCenterState({
      mode: "live",
      baseUrl: "http://127.0.0.1:4096",
      client: {
        client: {
          session: {
            list: async () => ({ data: [] }),
          },
        },
      },
    })
    let reloads = 0

    const applied = await followLiveCommandCenterEvents(
      state,
      {
        subscribe: async function* () {
          yield { type: "server.instance.disposed", properties: {} }
        },
      },
      {
        onBootstrapReload: () => {
          reloads++
        },
      },
    )

    expect(applied).toBe(1)
    expect(reloads).toBe(1)
  })

  test("refreshes runtime probes from public status routes after probe events", async () => {
    let mcpCalls = 0
    let lspCalls = 0
    let codeIndexCalls = 0
    const probeClient = {
      client: {
        session: {
          list: async () => ({ data: [] }),
        },
        mcp: {
          status: async () => {
            mcpCalls++
            return {
              data:
                mcpCalls === 1
                  ? { github: { status: "failed" } }
                  : { github: { status: "connected" }, figma: { status: "needs_trust" } },
            }
          },
        },
        lsp: {
          status: async () => {
            lspCalls++
            return {
              data: lspCalls === 1 ? [] : [{ id: "ts", name: "typescript", root: ".", status: "connected" }],
            }
          },
        },
        debugEngine: {
          pendingPlans: async () => {
            codeIndexCalls++
            return {
              data: {
                count: codeIndexCalls === 1 ? 0 : 3,
                plans: [],
                toolCount: 6,
                graph: {
                  nodeCount: codeIndexCalls === 1 ? 0 : 120,
                  edgeCount: codeIndexCalls === 1 ? 0 : 240,
                  lastIndexedAt: null,
                  state: codeIndexCalls === 1 ? "idle" : "indexing",
                  completed: codeIndexCalls === 1 ? 0 : 4,
                  total: codeIndexCalls === 1 ? 0 : 8,
                  error: null,
                },
              },
            }
          },
        },
      },
    }
    const state = await bootstrapLiveCommandCenterState({
      mode: "live",
      baseUrl: "http://127.0.0.1:4096",
      client: probeClient,
    })
    const refreshed: string[][] = []

    const applied = await followLiveCommandCenterEvents(
      state,
      {
        subscribe: async function* () {
          yield { type: "mcp.tools.changed", properties: {} }
          yield { type: "lsp.updated", properties: {} }
          yield { type: "code.index.progress", properties: {} }
        },
      },
      {
        probeClient,
        probeDelayMs: 0,
        onProbeRefresh: (_catalog, keys) => refreshed.push(keys),
      },
    )

    expect(applied).toBe(3)
    expect(refreshed).toEqual([["mcp", "lsp", "debug-engine"]])
    expect(state.catalog.mcp).toMatchObject({ total: 2, connected: 1, needsTrust: 1 })
    expect(state.catalog.lsp).toMatchObject({ total: 1, connected: 1, error: 0 })
    expect(state.catalog.codeIndex).toMatchObject({
      pendingPlans: 3,
      nodeCount: 120,
      state: "indexing",
      completed: 4,
      total: 8,
    })
  })

  test("flushes pending runtime probe refreshes before surfacing stream errors", async () => {
    let mcpCalls = 0
    const probeClient = {
      client: {
        session: {
          list: async () => ({ data: [] }),
        },
        mcp: {
          status: async () => {
            mcpCalls++
            return {
              data: mcpCalls === 1 ? {} : { github: { status: "connected" } },
            }
          },
        },
      },
    }
    const state = await bootstrapLiveCommandCenterState({
      mode: "live",
      baseUrl: "http://127.0.0.1:4096",
      client: probeClient,
    })

    await expect(
      followLiveCommandCenterEvents(
        state,
        {
          subscribe: async function* () {
            yield { type: "mcp.tools.changed", properties: {} }
            throw new Error("stream disconnected")
          },
        },
        {
          probeClient,
          probeDelayMs: 0,
        },
      ),
    ).rejects.toThrow("stream disconnected")

    expect(state.catalog.mcp).toMatchObject({ total: 1, connected: 1 })
  })

  test("retries live event streams after a transient disconnect", async () => {
    const state = await bootstrapLiveCommandCenterState({
      mode: "live",
      baseUrl: "http://127.0.0.1:4096",
      client: {
        client: {
          session: {
            list: async () => ({ data: [] }),
          },
        },
      },
    })
    const statuses: string[] = []
    let attempts = 0

    const result = await followLiveCommandCenterEventsWithReconnect(
      state,
      () => ({
        subscribe: async function* () {
          attempts++
          if (attempts === 1) throw new Error("stream disconnected")
          yield {
            type: "session.created",
            properties: {
              info: {
                id: "ses_reconnected",
                title: "Reconnected session",
                project: "ax-code",
                updatedAt: 3,
              },
            },
          }
        },
      }),
      {
        maxAttempts: 2,
        retryDelayMs: 0,
        onStatus: (status) => statuses.push(status),
      },
    )

    expect(result).toEqual({ appliedCount: 1, attempts: 2, status: "connected" })
    expect(statuses).toEqual(["connecting", "error", "connecting", "connected"])
    expect(state.projection.session[0]?.id).toBe("ses_reconnected")
  })
})
