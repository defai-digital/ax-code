import { afterEach, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import path from "path"
import type { Tool } from "../../src/tool/tool"
import { ImageGenTool, resetImageProviderCacheForTests } from "../../src/tool/image_gen"
import { Instance } from "../../src/project/instance"
import { Isolation } from "../../src/isolation"
import { BlastRadius } from "../../src/session/blast-radius"
import { SessionID, MessageID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

const sessionID = SessionID.make("ses_image_gen_test")
const originalOpenAIKey = process.env["OPENAI_API_KEY"]

function context(isolation: Isolation.State, abort = new AbortController().signal): Tool.Context {
  return {
    sessionID,
    messageID: MessageID.make(""),
    callID: "",
    agent: "build",
    abort,
    messages: [],
    metadata: () => {},
    extra: { isolation },
    ask: async () => {},
  }
}

afterEach(async () => {
  if (originalOpenAIKey === undefined) delete process.env["OPENAI_API_KEY"]
  else process.env["OPENAI_API_KEY"] = originalOpenAIKey
  resetImageProviderCacheForTests()
  BlastRadius.reset(sessionID)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

describe("tool.image_gen", () => {
  test("saves generated images in an isolated user-visible directory without overwriting", async () => {
    await using tmp = await tmpdir({ git: true })
    process.env["OPENAI_API_KEY"] = "test-key"
    const bytes = Buffer.from("generated-image")
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [{ b64_json: bytes.toString("base64") }],
          output_format: "png",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    })
    vi.stubGlobal("fetch", fetchMock)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const isolation = Isolation.resolve({ mode: "workspace-write", network: true }, tmp.path, tmp.path)
        const tool = await ImageGenTool.init()
        const first = await tool.execute(
          {
            prompt: "draw an otter",
            name: "friendly otter",
          },
          context(isolation),
        )
        const second = await tool.execute(
          {
            prompt: "draw another otter",
            name: "friendly otter",
          },
          context(isolation),
        )

        const firstPath = path.join(tmp.path, "generated-images", "friendly-otter.png")
        const secondPath = path.join(tmp.path, "generated-images", "friendly-otter-2.png")
        expect(first.metadata.path).toBe(firstPath)
        expect(second.metadata.path).toBe(secondPath)
        expect(await fs.readFile(firstPath)).toEqual(bytes)
        expect(await fs.readFile(secondPath)).toEqual(bytes)
        expect(first.attachments?.[0]?.filename).toBe("friendly-otter.png")
        expect(fetchMock).toHaveBeenCalledTimes(2)
      },
    })
  })

  test("read-only isolation rejects before starting a paid request", async () => {
    await using tmp = await tmpdir({ git: true })
    process.env["OPENAI_API_KEY"] = "test-key"
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const isolation = Isolation.resolve({ mode: "read-only", network: true }, tmp.path, tmp.path)
        const tool = await ImageGenTool.init()
        await expect(
          tool.execute(
            {
              prompt: "draw an otter",
              name: "blocked",
            },
            context(isolation),
          ),
        ).rejects.toMatchObject({
          name: "IsolationDeniedError",
          reason: "write",
        })
        expect(fetchMock).not.toHaveBeenCalled()
        await expect(fs.access(path.join(tmp.path, "generated-images"))).rejects.toThrow()
      },
    })
  })

  test("aborted calls do not write the returned image", async () => {
    await using tmp = await tmpdir({ git: true })
    process.env["OPENAI_API_KEY"] = "test-key"
    const controller = new AbortController()
    const fetchMock = vi.fn(async () => {
      controller.abort()
      return new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from("late-image").toString("base64") }],
          output_format: "png",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    })
    vi.stubGlobal("fetch", fetchMock)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const isolation = Isolation.resolve({ mode: "workspace-write", network: true }, tmp.path, tmp.path)
        const tool = await ImageGenTool.init()
        await expect(
          tool.execute(
            {
              prompt: "draw an otter",
              name: "aborted",
            },
            context(isolation, controller.signal),
          ),
        ).rejects.toThrow()
        await expect(fs.access(path.join(tmp.path, "generated-images", "aborted.png"))).rejects.toThrow()
      },
    })
  })
})
