import path from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import { editConfigFile, parseConfig } from "../../src/config/file-update"
import { ConfigPaths } from "../../src/config/paths"
import { Filesystem } from "../../src/util/filesystem"
import { patchJsonc } from "../../src/util/jsonc"
import { tmpdir } from "../fixture/fixture"

afterEach(() => {
  vi.restoreAllMocks()
})

test("concurrent config edits preserve every patch, JSONC comments and unevaluated references", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "ax-code.jsonc")
  await Filesystem.write(file, '{\n // preserve this comment\n "username": "{env:AX_TEST_CONFIG_SECRET}"\n}\n')
  await Promise.all(
    [
      { model: "test/model" },
      { autoupdate: false },
      { snapshot: false },
      { instructions: ["{file:/outside/instructions.md}"] },
    ].map((patch) => editConfigFile(file, (before) => patchJsonc(before ?? "{}", patch))),
  )
  const text = await Filesystem.readText(file)
  expect(text).toContain("// preserve this comment")
  expect(parseConfig(text, file)).toMatchObject({
    username: "{env:AX_TEST_CONFIG_SECRET}",
    model: "test/model",
    autoupdate: false,
    snapshot: false,
    instructions: ["{file:/outside/instructions.md}"],
  })
})

test.each(["editor", "syntax", "schema", "write"] as const)(
  "%s failure preserves the config and releases both locks for the next edit",
  async (failureMode) => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "ax-code.jsonc")
    const original = '{\n // keep\n "model": "before/model"\n}\n'
    await Filesystem.write(file, original)
    const failure = new Error("transaction failed")
    if (failureMode === "write") vi.spyOn(Filesystem, "write").mockRejectedValueOnce(failure)
    const attempt = editConfigFile(file, (before) => {
      if (failureMode === "editor") throw failure
      if (failureMode === "syntax") return "{ invalid jsonc"
      return patchJsonc(before ?? "{}", { model: failureMode === "schema" ? 123 : "after/model" })
    })
    if (failureMode === "schema") await expect(attempt).rejects.toBeInstanceOf(ConfigPaths.InvalidError)
    else if (failureMode === "syntax") await expect(attempt).rejects.toBeInstanceOf(ConfigPaths.JsonError)
    else await expect(attempt).rejects.toBe(failure)
    expect(await Filesystem.readText(file)).toBe(original)
    await expect(
      editConfigFile(file, (before) => patchJsonc(before ?? "{}", { model: "retry/model" })),
    ).resolves.toMatchObject({ model: "retry/model" })
  },
)

test("an absent edit does not create a config file", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "ax-code.jsonc")
  await expect(editConfigFile(file, () => undefined)).resolves.toBeUndefined()
  expect(await Filesystem.exists(file)).toBe(false)
})

test("unchanged writes can be skipped without changing the default write contract", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "ax-code.jsonc")
  await Filesystem.write(file, '{ "model": "test/model" }')
  const write = vi.spyOn(Filesystem, "write")
  await editConfigFile(file, (before) => before!, { skipUnchanged: true })
  expect(write).not.toHaveBeenCalled()
  await editConfigFile(file, (before) => before!)
  expect(write).toHaveBeenCalledOnce()
})
