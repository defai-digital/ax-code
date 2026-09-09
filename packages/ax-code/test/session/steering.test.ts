import { createUserMessage } from "../../src/session/prompt-user-message"
import { Session } from "../../src/session"
import { Plugin } from "../../src/plugin"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { afterEach, describe, expect, test, vi } from "vitest"
import { SessionSteering } from "../../src/session/steering"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

describe("generation-scoped steering", () => {
  test("deduplicates admission, preserves receipts, and conflicts on changed content", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = SessionID.ascending()
        const controller = new AbortController()
        SessionSteering.begin(id, controller.signal)
        const input = {
          expectedGeneration: SessionSteering.view(id).generation!,
          clientID: "correction_1",
          text: "Keep the public API unchanged",
        }
        let release!: () => void
        let hooks = 0
        const pending = SessionSteering.submit(id, input, async () => {
          hooks++
          await new Promise<void>((resolve) => {
            release = resolve
          })
        })
        const duplicate = SessionSteering.submit(id, input, async () => {
          hooks++
        })
        release()
        expect(await pending).toEqual(await duplicate)
        expect(hooks).toBe(1)
        await expect(SessionSteering.submit(id, { ...input, text: "Changed" }, async () => {})).rejects.toThrow(
          "different steering content",
        )
        let writes = 0
        expect(
          await SessionSteering.drain(id, controller.signal, async ({ text, beforeCommit, afterCommit }) => {
            expect(text).toBe(input.text)
            beforeCommit()
            writes++
            afterCommit()
          }),
        ).toBe(true)
        SessionSteering.finish(id)
        expect((await SessionSteering.submit(id, input, async () => {})).status).toBe("applied")
        expect(writes).toBe(1)
      },
    })
  })

  test("rejects stale generations before hooks and cancellation during hooks", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = SessionID.ascending()
        const controller = new AbortController()
        SessionSteering.begin(id, controller.signal)
        const generation = SessionSteering.view(id).generation!
        SessionSteering.finish(id)
        let hooks = 0
        expect(
          (
            await SessionSteering.submit(
              id,
              { expectedGeneration: generation, clientID: "stale", text: "old" },
              async () => {
                hooks++
              },
            )
          ).status,
        ).toBe("rejected")
        expect(hooks).toBe(0)
        SessionSteering.begin(id, controller.signal)
        const input = { expectedGeneration: SessionSteering.view(id).generation!, clientID: "cancelled", text: "stop" }
        expect(
          (
            await SessionSteering.submit(id, input, async () => {
              controller.abort()
              SessionSteering.finish(id)
            })
          ).status,
        ).toBe("rejected")
      },
    })
  })

  test("a successor generation cannot commit pending text from its predecessor", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = SessionID.ascending()
        const old = new AbortController()
        SessionSteering.begin(id, old.signal)
        const input = {
          expectedGeneration: SessionSteering.view(id).generation!,
          clientID: "race",
          text: "Fix this attempt only",
        }
        await SessionSteering.submit(id, input, async () => {})
        let writes = 0
        await SessionSteering.drain(id, old.signal, async ({ beforeCommit, afterCommit }) => {
          SessionSteering.begin(id, new AbortController().signal)
          beforeCommit()
          writes++
          afterCommit()
        })
        expect(writes).toBe(0)
        expect(SessionSteering.view(id).receipts[0].status).toBe("rejected")
      },
    })
  })
})

afterEach(() => vi.restoreAllMocks())
test("rechecks generation inside the actual message transaction after asynchronous plugin transforms", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const old = new AbortController()
      SessionSteering.begin(session.id, old.signal)
      const request = {
        expectedGeneration: SessionSteering.view(session.id).generation!,
        clientID: "plugin_race",
        text: "Keep the existing public API",
      }
      await SessionSteering.submit(session.id, request, async () => {})
      vi.spyOn(Plugin, "trigger").mockImplementation((async (name: string, _input: unknown, output: unknown) => {
        if (name === "chat.message") SessionSteering.begin(session.id, new AbortController().signal)
        return output
      }) as typeof Plugin.trigger)
      await SessionSteering.drain(session.id, old.signal, (steering) =>
        createUserMessage(
          {
            sessionID: session.id,
            messageID: steering.messageID,
            agent: "build",
            agentRouting: "preserve",
            model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5.2") },
            parts: [{ type: "text", text: steering.text }],
          },
          steering,
        ),
      )
      expect(SessionSteering.view(session.id).receipts[0].status).toBe("rejected")
      expect(await Session.messages({ sessionID: session.id })).toEqual([])
    },
  })
})
