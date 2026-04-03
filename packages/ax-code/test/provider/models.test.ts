import path from "path"
import { afterEach, expect, test } from "bun:test"
import { ModelsDev } from "../../src/provider/models"
import { tmpdir } from "../fixture/fixture"

const originalFile = process.env["AX_CODE_MODELS_PATH"]
const originalUrl = process.env["AX_CODE_MODELS_URL"]

afterEach(() => {
  if (originalFile === undefined) delete process.env["AX_CODE_MODELS_PATH"]
  else process.env["AX_CODE_MODELS_PATH"] = originalFile
  if (originalUrl === undefined) delete process.env["AX_CODE_MODELS_URL"]
  else process.env["AX_CODE_MODELS_URL"] = originalUrl
  ModelsDev.Data.reset()
})

test("falls back to bundled snapshot when custom models file is corrupted", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "bad-models.json")
  await Bun.write(file, "{ invalid json")

  process.env["AX_CODE_MODELS_PATH"] = file
  delete process.env["AX_CODE_MODELS_URL"]
  ModelsDev.Data.reset()

  const data = await ModelsDev.get()
  expect(Object.keys(data).length).toBeGreaterThan(0)
})

test("filters Google Gemini models below version 3", async () => {
  const data = await ModelsDev.get()
  const google = data["google"]
  expect(google).toBeDefined()
  const ids = Object.keys(google?.models ?? {})
  expect(ids.some((id) => id.includes("gemini-2"))).toBe(false)
  expect(ids.some((id) => id.includes("gemini-1"))).toBe(false)
})

test("filters OpenAI GPT models below version 4", async () => {
  const data = await ModelsDev.get()
  const openai = data["openai"]
  expect(openai).toBeDefined()
  const ids = Object.keys(openai?.models ?? {})
  expect(ids.some((id) => id.includes("gpt-3"))).toBe(false)
})
