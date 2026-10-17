import { afterEach, expect, test, vi } from "vitest"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { SessionID, MessageID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"
import type { Tool } from "../../src/tool/tool"
import fs from "node:fs/promises"
import path from "node:path"

afterEach(async () => {
  vi.unstubAllEnvs()
  await Instance.disposeAll()
})

test.each(["ls", 'python3 -c \'open(".env","w").write("x")\'', "cp source output"])(
  "bash supplies the complete effective command and cwd before execution: %s",
  async (command) => {
    vi.stubEnv("AX_CODE_AUTONOMOUS", "false")
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "source"), "test")
    await fs.mkdir(path.join(tmp.path, "output"))
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await BashTool.init()
        const requests: Parameters<Tool.Context["ask"]>[0][] = []
        const stop = new Error("Stop before shell execution")
        await expect(
          tool.execute(
            { command, description: "Inspect approval metadata" },
            {
              sessionID: SessionID.make("ses_bash_metadata"),
              messageID: MessageID.make("msg_bash_metadata"),
              agent: "build",
              abort: new AbortController().signal,
              messages: [],
              extra: { isolation: { mode: "full-access", network: true, protected: [] } },
              metadata: async () => {},
              ask: async (request) => {
                requests.push(request)
                throw stop
              },
            },
          ),
        ).rejects.toBe(stop)
        expect(requests).toContainEqual(
          expect.objectContaining({
            permission: "bash",
            metadata: expect.objectContaining({ command, bashCommand: command, bashCwd: tmp.path }),
          }),
        )
        if (command.startsWith("cp ")) {
          expect(requests.find((request) => request.permission === "bash")?.metadata.paths).toContain(
            path.join(tmp.path, "output", "source"),
          )
        }
      },
    })
  },
)
