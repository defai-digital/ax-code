import { afterEach, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { Permission } from "../../src/permission"
import { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

afterEach(() => Instance.disposeAll())

test.each(["bash", "bash_destructive", "isolation_escalation", "computer"])(
  "rejects an empty target list for %s instead of bypassing permission checks",
  async (permission) => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(
          Permission.ask({
            sessionID: SessionID.make("ses_empty_patterns"),
            permission,
            patterns: [],
            metadata: {},
            always: [],
            ruleset: [{ permission: "*", pattern: "*", action: "deny" }],
          }),
        ).rejects.toThrow("Permission requests must include at least one pattern")
        expect(await Permission.list()).toEqual([])
      },
    })
  },
)
