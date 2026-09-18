import { describe, expect, test } from "vitest"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import { ACP } from "../../src/acp/agent"

function createListAgent(sessions: any[]) {
  const connectionAbort = new AbortController()
  const connection = {
    async sessionUpdate() {},
    async requestPermission() {
      return { outcome: { outcome: "selected", optionId: "once" } }
    },
    signal: connectionAbort.signal,
  } as unknown as AgentSideConnection

  const sdk = {
    global: {
      event: async (opts?: { signal?: AbortSignal }) => ({
        stream: (async function* () {
          await new Promise<void>((resolve) => {
            if (opts?.signal?.aborted) {
              resolve()
              return
            }
            opts?.signal?.addEventListener("abort", () => resolve(), { once: true })
          })
        })(),
      }),
    },
    session: {
      list: async () => ({ data: sessions }),
    },
  } as any

  const agent = new ACP.Agent(connection, {
    sdk,
    defaultModel: { providerID: "test", modelID: "test-model" },
  } as any)

  return { agent, stop: () => connectionAbort.abort() }
}

describe("ACP session list", () => {
  test("sanitizes malformed session updated timestamps", async () => {
    const { agent, stop } = createListAgent([
      {
        id: "ses_bad",
        directory: "/repo",
        title: "Bad timestamp",
        time: { updated: Number.NaN },
      },
      {
        id: "ses_new",
        directory: "/repo",
        title: "Newer",
        time: { updated: 2_000 },
      },
      {
        id: "ses_old",
        directory: "/repo",
        title: "Older",
        time: { updated: 1_000 },
      },
    ])

    try {
      const first = await agent.unstable_listSessions({ cwd: "/repo" } as any)
      expect(first.sessions.map((session) => session.sessionId)).toEqual(["ses_new", "ses_old", "ses_bad"])
      expect(first.sessions[2]?.updatedAt).toBe("1970-01-01T00:00:00.000Z")

      // The cursor is a positional offset into the sorted list (index 1 skips
      // the first, newest session), not a timestamp.
      const second = await agent.unstable_listSessions({ cwd: "/repo", cursor: "1" } as any)
      expect(second.sessions.map((session) => session.sessionId)).toEqual(["ses_old", "ses_bad"])
    } finally {
      stop()
    }
  })

  test("does not drop sessions tied at the page boundary timestamp", async () => {
    // 150 sessions sharing one timestamp, spanning the 100-item page limit.
    // A timestamp-based cursor can't tell "already returned" apart from "not
    // yet returned" among ties, and would silently drop everything past the
    // first page here.
    const sessions = Array.from({ length: 150 }, (_, i) => ({
      id: `ses_${i}`,
      directory: "/repo",
      title: `Session ${i}`,
      time: { updated: 5_000 },
    }))
    const { agent, stop } = createListAgent(sessions)

    try {
      const first = await agent.unstable_listSessions({ cwd: "/repo" } as any)
      expect(first.sessions).toHaveLength(100)
      expect(first.nextCursor).toBeDefined()

      const second = await agent.unstable_listSessions({ cwd: "/repo", cursor: first.nextCursor } as any)
      expect(second.sessions).toHaveLength(50)
      expect(second.nextCursor).toBeUndefined()

      const seen = new Set([...first.sessions, ...second.sessions].map((s) => s.sessionId))
      expect(seen.size).toBe(150)
    } finally {
      stop()
    }
  })
})
