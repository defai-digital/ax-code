import { ProviderID, ModelID } from "../../src/provider/schema"
import { expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { Bus } from "../../src/bus"
import { createHeadlessProjectionState, applyHeadlessProjectionEvent } from "../../src/runtime/headless"
import { hiddenMessageIDs } from "../../src/cli/cmd/tui/routes/session/revert"
import { tmpdir } from "../fixture/fixture"

test("real new prompt after revert clears serialized UI undo state and keeps the new message visible", async () => {
  await using tmp = await tmpdir({ git: true, config: { agent: { build: { model: "openai/gpt-5.4" } } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const state = createHeadlessProjectionState<
        Session.Info,
        unknown,
        unknown,
        unknown,
        { id: string; sessionID: string; role: "user" | "assistant" },
        { id: string; messageID: string }
      >()
      const stop = Bus.subscribeAll((event) => applyHeadlessProjectionEvent(state, JSON.parse(JSON.stringify(event))))
      const session = await Session.create({})
      const prompt = (text: string) =>
        SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5.4") },
          parts: [{ type: "text", text }],
        })
      try {
        const kept = await prompt("kept")
        const discarded = await prompt("discarded")
        await SessionRevert.revert({ sessionID: session.id, messageID: discarded.info.id })
        await expect
          .poll(() => state.session.find((x) => x.id === session.id)?.revert?.messageID)
          .toBe(discarded.info.id)
        const replacement = await prompt("new message after undo")
        await expect.poll(() => state.session.find((x) => x.id === session.id)?.revert).toBeUndefined()
        const stored = await Session.messages({ sessionID: session.id })
        expect(stored.map((x) => x.info.id)).toEqual([kept.info.id, replacement.info.id])
        expect((await Session.get(session.id)).revert).toBeUndefined()
        expect(
          hiddenMessageIDs(state.message[session.id], state.session.find((x) => x.id === session.id)?.revert?.messageID)
            .size,
        ).toBe(0)
        expect(state.message[session.id].map((x) => x.id)).toEqual([kept.info.id, replacement.info.id])
      } finally {
        stop()
        await Session.remove(session.id)
      }
    },
  })
})
