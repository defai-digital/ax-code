import { describe, expect, test } from "bun:test"
import { getRuntimeConfig } from "../src/runtime/config"
import {
  applyLiveRuntimeEvent,
  bootstrapLiveCommandCenterState,
  followLiveCommandCenterEvents,
} from "../src/runtime/live"

describe("app live runtime", () => {
  test("defaults to fixture mode without injected backend config", () => {
    expect(getRuntimeConfig({ window: {} as Window })).toEqual({ mode: "fixture" })
  })

  test("bootstraps read-only sessions from a live-compatible client", async () => {
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
          },
          config: {
            providers: async () => ({
              data: {
                providers: [
                  {
                    id: "openai",
                    name: "OpenAI",
                    source: "env",
                    models: [{ id: "gpt-5-codex", name: "gpt-5-codex" }],
                  },
                ],
                default: { openai: "gpt-5-codex" },
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
          worktree: {
            list: async () => ({
              data: ["/workspace/ax-code", "/workspace/.ax-code/worktrees/wt-live"],
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
              sessionID: "ses_live",
              kind: "prompt",
              status: "queued",
              priority: 10,
              position: 0,
              title: "Queue from backend",
              agent: "build",
              model: { providerID: "test", modelID: "test-model" },
              payload: {},
              time: { created: 1_800 },
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
              nextRunAt: 2_000,
              time: { created: 1_000 },
            },
          ],
        },
        sessionEvidence: {
          load: async (sessionID) => ({
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
              envelopes: [{ id: "env_1" }],
              reviewResults: [{ reviewId: "rev_1" }],
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
          }),
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
    expect(state.queue[0]).toMatchObject({
      id: "tsk_live",
      project: "project_live",
      sessionID: "ses_live",
      title: "Queue from backend",
      status: "queued",
      agent: "build",
    })
    expect(state.evidence.ses_live?.risk).toMatchObject({ level: "HIGH", score: 71 })
    expect(state.evidence.ses_live?.semantic?.headline).toBe("Changes command-center shell")
    expect(state.evidence.ses_live?.rollbackPoints[0]?.step).toBe(4)
    expect(state.evidence.ses_live?.rollbackPoints[0]?.messageID).toBe("msg_assistant")
    expect(state.evidence.ses_live?.rollbackPoints[0]?.tokens).toEqual({ input: 200, output: 50 })
    expect(state.evidence.ses_live?.artifactCounts.reviewResults).toBe(1)
    expect(state.catalog.agents[0]).toMatchObject({ id: "build", label: "Build" })
    expect(state.catalog.providers[0]).toMatchObject({
      id: "openai",
      label: "OpenAI",
      source: "env",
      modelCount: 1,
      defaultModelID: "gpt-5-codex",
      status: "available",
    })
    expect(state.catalog.models[0]).toMatchObject({ providerID: "openai", modelID: "gpt-5-codex" })
    expect(state.worktrees.map((worktree) => worktree.name)).toContain("wt-live")
    expect(state.terminals[0]).toMatchObject({ id: "pty_live", title: "Live terminal", status: "running" })
    expect(state.scheduledTasks[0]).toMatchObject({ id: "sch_live", title: "Daily branch review", status: "active" })
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
            kind: "review",
            status: "running",
            priority: 0,
            position: 0,
            title: "Review queued branch",
            payload: {},
            time: { created: 2_000 },
          },
        },
      }),
    ).toBe(true)
    expect(state.queue[0]).toMatchObject({ id: "tsk_event", status: "running" })

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
})
