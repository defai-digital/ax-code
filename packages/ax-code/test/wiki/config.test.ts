import { afterEach, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { resolveWikiRuntimeConfig } from "../../src/wiki/config"
import { tmpdir } from "../fixture/fixture"

afterEach(() => Instance.disposeAll())

test("runtime Wiki defaults to the hidden repository directory", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(await resolveWikiRuntimeConfig()).toMatchObject({ dir: ".ax-wiki" })
    },
  })
})

test("project config selects a custom directory and CLI overrides take precedence", async () => {
  await using tmp = await tmpdir({ git: true, config: { wiki: { dir: "docs/knowledge" } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(await resolveWikiRuntimeConfig()).toMatchObject({ dir: "docs/knowledge" })
      expect(await resolveWikiRuntimeConfig({ dir: "other-wiki" })).toMatchObject({ dir: "other-wiki" })
    },
  })
})
