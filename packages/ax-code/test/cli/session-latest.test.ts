import { afterEach, expect, test } from "vitest"
import { resolveSession } from "../../src/cli/cmd/session-latest"
import { Instance } from "../../src/project/instance"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

test("an unknown explicit session id resolves to no session instead of throwing", async () => {
  await using project = await tmpdir({ git: true })
  await Instance.provide({
    directory: project.path,
    fn: async () => {
      await expect(resolveSession("ses_doesnotexist")).resolves.toBeUndefined()
    },
  })
})
