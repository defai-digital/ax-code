import { afterEach, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Question } from "../../src/question"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { MessageID } from "../../src/session/schema"
import { PlanExitTool } from "../../src/tool/plan"
import { tmpdir } from "../fixture/fixture"

afterEach(() => vi.restoreAllMocks())

test.each([
  { answers: [] },
  { answers: [[]] },
  { answers: [["No"]] },
  { answers: [["Unexpected"]] },
  { answers: [["Yes", "No"]] },
  { answers: [["Yes"], ["No"]] },
  { answers: [["Yes"]] },
])("plan exit requires the Yes answer (%j)", async ({ answers }) => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const user = await Session.updateMessage({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "user",
        agent: "plan",
        model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
        time: { created: Date.now() },
      })
      vi.spyOn(Question, "ask").mockResolvedValue(answers)
      const execution = (await PlanExitTool.init()).execute(
        {},
        {
          sessionID: session.id,
          messageID: user.id,
          agent: "plan",
          abort: new AbortController().signal,
          messages: [],
          metadata: () => {},
          ask: async () => {},
        },
      )
      if (answers.length === 1 && answers[0]?.length === 1 && answers[0][0] === "Yes") {
        await expect(execution).resolves.toMatchObject({ title: "Switching to build agent" })
        const messages = await Session.messages({ sessionID: session.id })
        expect(messages).toHaveLength(2)
        expect(messages.at(-1)!.info).toMatchObject({ role: "user", agent: "build" })
      } else {
        await expect(execution).rejects.toBeInstanceOf(Question.RejectedError)
        expect(await Session.messages({ sessionID: session.id })).toHaveLength(1)
      }
    },
  })
})
