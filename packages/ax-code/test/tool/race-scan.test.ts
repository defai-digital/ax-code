import { describe, expect, test } from "vitest"
import fs from "node:fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { RaceScanTool } from "../../src/tool/race_scan"

describe("race_scan", () => {
  test("stops when the tool call is aborted", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "cache.ts"), "const cache = new Map<string, number>()\n")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const controller = new AbortController()
        controller.abort()
        const tool = await RaceScanTool.init()
        await expect(
          tool.execute(
            { patterns: ["toctou"] } as any,
            {
              sessionID: "ses_race_scan",
              messageID: "msg_race_scan",
              callID: "",
              agent: "build",
              abort: controller.signal,
              messages: [],
              metadata: () => {},
              ask: async () => {},
              extra: {},
            } as any,
          ),
        ).rejects.toThrow(/abort/i)
      },
    })
  })
})
