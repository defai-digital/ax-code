import path from "node:path"
import fs from "node:fs/promises"
import { afterEach, expect, test, vi } from "vitest"
import { editConfigFile, editConfigFileWithRollback, parseConfig } from "../../src/config/file-update"
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

test("config rollback restores the raw JSONC document once", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "ax-code.jsonc")
  const original = '{\n // Keep this note\n "username": "{env:AX_CONFIG_REFERENCE}"\n}\n'
  await Filesystem.write(file, original)
  const result = await editConfigFileWithRollback(file, (before) => patchJsonc(before ?? "{}", { model: "new/model" }))
  if (!result) throw new Error("Missing config rollback")
  expect(result.value.model).toBe("new/model")
  expect(await result.rollback()).toBe(true)
  expect(await Filesystem.readText(file)).toBe(original)
  await editConfigFile(file, (before) => patchJsonc(before ?? "{}", { model: "later/model" }))
  await result.rollback()
  expect(parseConfig(await Filesystem.readText(file), file).model).toBe("later/model")
})

test.each(["different", "identical"] as const)("config rollback preserves a peer's %s write", async (kind) => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "ax-code.jsonc")
  await Filesystem.write(file, '{ "model": "old/model" }')
  const result = await editConfigFileWithRollback(file, () => '{ "model": "new/model" }')
  if (!result) throw new Error("Missing config rollback")
  const peer = kind === "identical" ? await Filesystem.readText(file) : '{ "model": "peer/model" }'
  await Filesystem.write(file, peer)
  expect(await result.rollback()).toBe(false)
  expect(await Filesystem.readText(file)).toBe(peer)
})

test("config rollback does not recreate a file removed by a peer", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "ax-code.jsonc")
  await Filesystem.write(file, "{}")
  const result = await editConfigFileWithRollback(file, () => '{ "model": "new/model" }')
  if (!result) throw new Error("Missing config rollback")
  await fs.unlink(file)
  expect(await result.rollback()).toBe(false)
  expect(await Filesystem.exists(file)).toBe(false)
})

test("config rollback removes a newly created file only once", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "ax-code.jsonc")
  const result = await editConfigFileWithRollback(file, () => '{ "model": "new/model" }')
  if (!result) throw new Error("Missing config rollback")
  expect(await result.rollback()).toBe(true)
  expect(await Filesystem.exists(file)).toBe(false)
  await Filesystem.write(file, '{ "model": "peer/model" }')
  await result.rollback()
  expect(parseConfig(await Filesystem.readText(file), file).model).toBe("peer/model")
})

test("failure to capture config ownership restores the document before releasing its locks", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "ax-code.jsonc")
  const original = '{ "model": "old/model" }'
  await Filesystem.write(file, original)
  const failure = new Error("Revision read failed")
  vi.spyOn(fs, "lstat").mockRejectedValueOnce(failure)
  await expect(editConfigFileWithRollback(file, () => '{ "model": "new/model" }')).rejects.toBe(failure)
  expect(await Filesystem.readText(file)).toBe(original)
  await expect(editConfigFile(file, () => '{ "model": "retry/model" }')).resolves.toMatchObject({
    model: "retry/model",
  })
})

test("failed config rollback preserves the written document and releases its locks", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "ax-code.jsonc")
  await Filesystem.write(file, '{ "model": "old/model" }')
  const result = await editConfigFileWithRollback(file, () => '{ "model": "new/model" }')
  if (!result) throw new Error("Missing config rollback")
  const failure = new Error("Restore write failed")
  vi.spyOn(Filesystem, "write").mockRejectedValueOnce(failure)
  await expect(result.rollback()).rejects.toBe(failure)
  expect(parseConfig(await Filesystem.readText(file), file).model).toBe("new/model")
  await expect(editConfigFile(file, () => '{ "model": "retry/model" }')).resolves.toMatchObject({
    model: "retry/model",
  })
})

test("an unchanged config transaction does not acquire rollback ownership", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "ax-code.jsonc")
  await Filesystem.write(file, '{ "model": "old/model" }')
  const write = vi.spyOn(Filesystem, "write")
  const result = await editConfigFileWithRollback(file, (before) => before, { skipUnchanged: true })
  if (!result) throw new Error("Missing config result")
  expect(result.value.model).toBe("old/model")
  expect(await result.rollback()).toBe(false)
  expect(write).not.toHaveBeenCalled()
})

test.each(["syntax", "schema"] as const)("rollback-capable edits reject invalid %s before writing", async (kind) => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "ax-code.jsonc")
  const original = '{ "model": "old/model" }'
  await Filesystem.write(file, original)
  await expect(
    editConfigFileWithRollback(file, () => (kind === "syntax" ? "{ invalid" : '{ "model": 123 }')),
  ).rejects.toBeInstanceOf(kind === "syntax" ? ConfigPaths.JsonError : ConfigPaths.InvalidError)
  expect(await Filesystem.readText(file)).toBe(original)
  await expect(editConfigFile(file, () => '{ "model": "retry/model" }')).resolves.toMatchObject({
    model: "retry/model",
  })
})

test("failure to capture ownership surfaces a failed compensating write", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "ax-code.jsonc")
  await Filesystem.write(file, '{ "model": "old/model" }')
  const captureFailure = new Error("Revision read failed")
  const restoreFailure = new Error("Compensating write failed")
  const write = Filesystem.write
  vi.spyOn(fs, "lstat").mockRejectedValueOnce(captureFailure)
  vi.spyOn(Filesystem, "write").mockImplementationOnce(write).mockRejectedValueOnce(restoreFailure)
  await expect(editConfigFileWithRollback(file, () => '{ "model": "new/model" }')).rejects.toMatchObject({
    name: "AggregateError",
    errors: [captureFailure, restoreFailure],
  })
  expect(parseConfig(await Filesystem.readText(file), file).model).toBe("new/model")
  await expect(editConfigFile(file, () => '{ "model": "retry/model" }')).resolves.toMatchObject({
    model: "retry/model",
  })
})
