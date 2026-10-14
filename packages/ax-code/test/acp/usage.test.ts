import { describe, expect, test } from "vitest"
import { sendUsageUpdate } from "../../src/acp/usage"

describe("acp usage update", () => {
  test("counts cache-read and cache-write tokens in the used context size", async () => {
    const updates: any[] = []
    const connection = {
      sessionUpdate: async (params: any) => {
        updates.push(params)
      },
    } as any
    const sdk = {
      config: {
        providers: async () => ({
          data: { providers: [{ id: "anthropic", models: { claude: { limit: { context: 200_000 } } } }] },
        }),
      },
      session: {
        messages: async () => ({
          data: [
            {
              info: {
                role: "assistant",
                providerID: "anthropic",
                modelID: "claude",
                // input excludes both cache reads and cache writes, so both must
                // be added; dropping cache write under-reports the context gauge.
                tokens: { input: 100, cache: { read: 1_000, write: 5_000 } },
              },
              parts: [],
            },
          ],
        }),
      },
    } as any

    await sendUsageUpdate(connection, sdk, "ses_usage", "/repo")

    expect(updates).toHaveLength(1)
    expect(updates[0].update).toMatchObject({ sessionUpdate: "usage_update", used: 6_100, size: 200_000 })
  })

  test("reports the live step's prompt tokens instead of the turn total", async () => {
    const updates: any[] = []
    const connection = {
      sessionUpdate: async (params: any) => {
        updates.push(params)
      },
    } as any
    const sdk = {
      config: {
        providers: async () => ({
          data: { providers: [{ id: "anthropic", models: { claude: { limit: { context: 200_000 } } } }] },
        }),
      },
      session: {
        messages: async () => ({
          data: [
            {
              info: {
                role: "assistant",
                providerID: "anthropic",
                modelID: "claude",
                // The message totals accumulate every step of the turn, so they
                // sum both prompts below instead of describing the live window.
                tokens: { input: 2_500, cache: { read: 0, write: 0 } },
              },
              parts: [
                {
                  type: "step-finish",
                  tokens: { input: 1_000, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
                },
                {
                  type: "step-finish",
                  tokens: { input: 1_500, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
                },
              ],
            },
          ],
        }),
      },
    } as any

    await sendUsageUpdate(connection, sdk, "ses_usage_steps", "/repo")

    expect(updates).toHaveLength(1)
    expect(updates[0].update).toMatchObject({ sessionUpdate: "usage_update", used: 1_500, size: 200_000 })
  })
})
