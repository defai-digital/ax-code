import { afterEach, describe, test, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import z from "zod"
import { FILE_PATH_ALIAS_KEYS, withFilePathAliases } from "../../src/tool/file-path"
import { WriteTool } from "../../src/tool/write"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"

const ctx = {
  sessionID: SessionID.make("ses_test-file-path-session"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("withFilePathAliases", () => {
  const schema = withFilePathAliases(
    z.object({
      content: z.string(),
      filePath: z.string().min(1),
    }),
  )

  test("rewrites the `file` alias to filePath (the qwen3-coder failure mode)", () => {
    expect(schema.parse({ content: "x", file: "/a/b.html" })).toEqual({
      content: "x",
      filePath: "/a/b.html",
    })
  })

  test("accepts every documented alias", () => {
    for (const key of FILE_PATH_ALIAS_KEYS) {
      expect(schema.parse({ content: "x", [key]: "/a/b.html" })).toMatchObject({
        filePath: "/a/b.html",
      })
    }
  })

  test("leaves a correct call untouched", () => {
    expect(schema.parse({ content: "x", filePath: "/a/b.html" })).toEqual({
      content: "x",
      filePath: "/a/b.html",
    })
  })

  test("does not override an explicit filePath with an alias", () => {
    expect(schema.parse({ content: "x", filePath: "/real.html", file: "/alias.html" })).toMatchObject({
      filePath: "/real.html",
    })
  })

  test("falls back to an alias when filePath is an empty string", () => {
    // An empty canonical filePath is not a usable path; a valid alias present
    // alongside it should be used instead of leaving the call to fail on "".
    expect(schema.parse({ content: "x", filePath: "", file: "/a/b.html" })).toMatchObject({
      filePath: "/a/b.html",
    })
  })

  test("rejects an empty filePath when no alias is present", () => {
    expect(schema.safeParse({ content: "x", filePath: "" }).success).toBe(false)
  })

  test("still rejects when neither filePath nor an alias is present", () => {
    expect(schema.safeParse({ content: "x" }).success).toBe(false)
  })

  test("does not advertise aliases in the model-facing JSON schema", () => {
    const json = z.toJSONSchema(schema) as { properties: Record<string, unknown>; required: string[] }
    expect(Object.keys(json.properties).sort()).toEqual(["content", "filePath"])
    expect(json.required).toContain("filePath")
  })
})

describe("WriteTool with filePath alias", () => {
  test("writes the file when the model uses `file` instead of `filePath`", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "index.html")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const write = await WriteTool.init()
        const result = await write.execute(
          // mirrors ses_13433ef11ffed5bAnaa0hPs5V5: { content, file } with no filePath
          { content: "<!DOCTYPE html>", file: filepath } as any,
          ctx,
        )

        expect(result.output).toContain("Wrote file successfully")
        expect(await fs.readFile(filepath, "utf-8")).toBe("<!DOCTYPE html>")
      },
    })
  })
})
