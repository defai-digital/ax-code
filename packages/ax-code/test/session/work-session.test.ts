import { describe, expect, test } from "vitest"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { createWorkSession, isWorkSessionMetadata, workSessionCreateIntent } from "../../src/session/work-session"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("createWorkSession", () => {
  test("intent is the Work agent plus Work product metadata", () => {
    expect(workSessionCreateIntent({ computer: true, providerID: "openai", modelID: "gpt-5.6-sol" })).toEqual({
      agent: "work",
      metadata: {
        work: { version: 1, computer: true, providerID: "openai", modelID: "gpt-5.6-sol" },
      },
    })
  })

  test("createWorkSession writes Work metadata on the shipped session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await createWorkSession({ computer: false })
        expect(session.metadata?.work).toEqual({ version: 1, computer: false })
        expect(isWorkSessionMetadata(session.metadata)).toBe(true)
        await Session.remove(session.id)
      },
    })
  })
})
