import { afterEach, describe, expect, test, vi } from "vitest"

import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { Config } from "../../src/config/config"
import { AX_ENGINE_PROVIDER_ID } from "../../src/provider/ax-engine"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"
import type { MessageV2 } from "../../src/session/message-v2"
import {
  capTitleWords,
  cleanGeneratedTitle,
  ensureTitle,
  fallbackTitleFromUserText,
  shouldSkipAutomaticTitle,
} from "../../src/session/prompt/prompt-title"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

describe("session prompt title", () => {
  test("title caps never leave half a surrogate pair", () => {
    expect(cleanGeneratedTitle("a".repeat(96) + "😀" + "bbbb")).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
    expect(fallbackTitleFromUserText("a".repeat(76) + "😀" + "bbbb")).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })

  test("skips automatic title generation for the managed ax-engine provider", () => {
    expect(shouldSkipAutomaticTitle({ providerID: ProviderID.make(AX_ENGINE_PROVIDER_ID) })).toBe(true)
    expect(shouldSkipAutomaticTitle({ providerID: ProviderID.make("groq") })).toBe(false)
  })

  test("cleanGeneratedTitle strips thinking blocks and wrappers", () => {
    expect(cleanGeneratedTitle("<think>pondering</think>\nCount lines of code")).toBe("Count lines of code")
    expect(cleanGeneratedTitle('"Debugging production 500s"')).toBe("Debugging production 500s")
    expect(cleanGeneratedTitle("Title: Auth refresh token support")).toBe("Auth refresh token support")
    expect(cleanGeneratedTitle("<think>only thinking</think>")).toBeUndefined()
    expect(cleanGeneratedTitle("<mm:think>pondering MiniMax style</mm:think>\nQuality review")).toBe("Quality review")
    expect(cleanGeneratedTitle("<mm:think>only thinking</mm:think>")).toBeUndefined()
    expect(cleanGeneratedTitle("   ")).toBeUndefined()
  })

  test("cleanGeneratedTitle strips quotes inside a Title: label", () => {
    expect(cleanGeneratedTitle('Title: "Fix login bug"')).toBe("Fix login bug")
    expect(cleanGeneratedTitle("Title: 'Fix login bug'")).toBe("Fix login bug")
    expect(cleanGeneratedTitle('"Title: Fix login bug"')).toBe("Fix login bug")
  })

  test("cleanGeneratedTitle keeps titles that start with 'The title' but drops preambles", () => {
    expect(cleanGeneratedTitle("The title bar overlaps the sidebar")).toBe("The title bar overlaps the sidebar")
    expect(cleanGeneratedTitle("The Title component crashes on resize")).toBe("The Title component crashes on resize")
    expect(cleanGeneratedTitle("Here's a concise title:\nFix login bug")).toBe("Fix login bug")
    expect(cleanGeneratedTitle("Here is the title:\nFix login bug")).toBe("Fix login bug")
    expect(cleanGeneratedTitle("The title is:\nFix login bug")).toBe("Fix login bug")
    expect(cleanGeneratedTitle("The session title would be\nFix login bug")).toBe("Fix login bug")
    expect(cleanGeneratedTitle("Here's a title\nFix login bug")).toBe("Fix login bug")
  })

  test("fallbackTitleFromUserText uses the first non-empty line", () => {
    expect(fallbackTitleFromUserText("count the line of code")).toBe("count the line of code")
    expect(fallbackTitleFromUserText("\n\n  hello world  \nmore")).toBe("hello world")
    expect(fallbackTitleFromUserText("a".repeat(100))).toBe("a".repeat(77) + "...")
    expect(fallbackTitleFromUserText("   \n  ")).toBeUndefined()
  })

  test("capTitleWords collapses whitespace and clamps to the 12-word budget", () => {
    expect(capTitleWords("  fix   the  flaky test ")).toBe("fix the flaky test")
    expect(capTitleWords("a b c", 2)).toBe("a b...")
    const twelve = "one two three four five six seven eight nine ten eleven twelve"
    expect(capTitleWords(twelve)).toBe(twelve)
    expect(capTitleWords(`${twelve} thirteen`)).toBe(`${twelve}...`)
  })

  test("cleanGeneratedTitle clamps a long generated title to 12 words", () => {
    const long = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen"
    expect(cleanGeneratedTitle(long)).toBe("one two three four five six seven eight nine ten eleven twelve...")
  })

  test("fallbackTitleFromUserText summarizes the first sentence within 12 words", () => {
    expect(
      fallbackTitleFromUserText(
        "the footer progress bar is not cool. also make the session id copyable and summarize the first prompt",
      ),
    ).toBe("the footer progress bar is not cool.")
    expect(
      fallbackTitleFromUserText("one two three four five six seven eight nine ten eleven twelve thirteen fourteen"),
    ).toBe("one two three four five six seven eight nine ten eleven twelve...")
  })

  test("fallbackTitleFromUserText does not treat dotted filenames or versions as sentence ends", () => {
    expect(fallbackTitleFromUserText(".gitignore is missing dist")).toBe(".gitignore is missing dist")
    expect(fallbackTitleFromUserText("Fix off-by-one in src/tool/read.ts line slicing")).toBe(
      "Fix off-by-one in src/tool/read.ts line slicing",
    )
    expect(fallbackTitleFromUserText("Upgrade to v1.2 and rerun")).toBe("Upgrade to v1.2 and rerun")
    expect(fallbackTitleFromUserText("Fix it. Then deploy the release")).toBe("Fix it.")
  })
})

describe("ensureTitle model resolution", () => {
  afterEach(() => vi.restoreAllMocks())

  test("an unavailable small_model titles with the session model", async () => {
    const sessionID = SessionID.make("ses_title_small_unavailable")
    const sessionModel = {
      id: ModelID.make("session-model"),
      providerID: ProviderID.make("openai"),
    } as Provider.Model
    const messageID = MessageID.make("msg_title_user")
    const history = [
      {
        info: { id: messageID, sessionID, role: "user", time: { created: 1 } },
        parts: [
          {
            id: PartID.make("prt_title_user"),
            sessionID,
            messageID,
            type: "text",
            text: "count the line of code",
          },
        ],
      },
    ] as unknown as MessageV2.WithParts[]

    vi.spyOn(Session, "isDefaultTitle").mockReturnValue(true)
    const setTitle = vi.spyOn(Session, "setTitle").mockResolvedValue({ id: sessionID } as Session.Info)
    vi.spyOn(Agent, "get").mockResolvedValue({ name: "title" } as Agent.Info)
    vi.spyOn(Config, "get").mockResolvedValue({ small_model: "deepseek/deepseek-v4-flash" } as Config.Info)
    vi.spyOn(Provider, "isLocalProvider").mockResolvedValue(false)
    vi.spyOn(Provider, "getModel").mockImplementation(async (providerID, modelID) => {
      if (`${providerID}/${modelID}` === "deepseek/deepseek-v4-flash") {
        throw new Provider.ModelNotFoundError({ providerID, modelID })
      }
      return sessionModel
    })
    const stream = vi.spyOn(LLM, "stream").mockResolvedValue({
      text: Promise.resolve("Count lines of code"),
    } as unknown as Awaited<ReturnType<typeof LLM.stream>>)

    await using tmp = await tmpdir()
    await Instance.provideScoped({
      directory: tmp.path,
      fn: () =>
        ensureTitle({
          session: { id: sessionID, title: "New session" } as Session.Info,
          history,
          providerID: ProviderID.make("openai"),
          modelID: ModelID.make("session-model"),
        }),
    })

    // The generated title is applied on the session model, not just the
    // deterministic fallback.
    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ model: sessionModel }))
    expect(setTitle.mock.calls.at(-1)?.[0]).toEqual({ sessionID, title: "Count lines of code" })
  })
})
