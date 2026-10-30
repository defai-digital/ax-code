import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, test } from "vitest"
import {
  applyAutocomplete,
  AutocompleteController,
  combineAutocompleteProviders,
  createFilePathProvider,
  createSlashCommandProvider,
  type AutocompleteRequest,
  type AutocompleteResult,
} from "../src/lib/autocomplete.js"

const signal = new AbortController().signal
const folders: string[] = []
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})

async function fixture(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "ax-tui-completion-"))
  folders.push(cwd)
  await Promise.all([
    mkdir(path.join(cwd, "folder")),
    writeFile(path.join(cwd, "file.ts"), ""),
    writeFile(path.join(cwd, "file name.ts"), ""),
    writeFile(path.join(cwd, ".hidden"), ""),
    writeFile(path.join(cwd, "中文😀.ts"), ""),
  ])
  return cwd
}

test("slash completion replaces the entire token at a middle cursor and preserves arguments", async () => {
  const provider = createSlashCommandProvider([{ name: "help", description: "Show help" }, { name: "hello" }])
  const request = { text: "/helpo arg", cursor: 3 }
  const result = (await provider(request, signal))!
  expect(result.items.map((item) => item.label)).toEqual(["/help", "/hello"])
  expect(applyAutocomplete(request, result, result.items[0])).toEqual({ text: "/help arg", cursor: 5 })
  expect(await provider({ text: "/help arg", cursor: 8 }, signal)).toBeNull()
  expect(await provider({ text: "say /help", cursor: 9 }, signal)).toBeNull()
  expect(() => createSlashCommandProvider([{ name: "/bad" }])).toThrow()
})

test("rejects stale edits, cursor movement, foreign items, and invalid UTF-16 boundaries", async () => {
  const request = { text: "/h", cursor: 2 }
  const result = (await createSlashCommandProvider([{ name: "help" }])(request, signal))!
  expect(applyAutocomplete({ text: "/he", cursor: 3 }, result, result.items[0])).toBeNull()
  expect(applyAutocomplete({ ...request, cursor: 1 }, result, result.items[0])).toBeNull()
  expect(applyAutocomplete(request, result, { ...result.items[0] })).toBeNull()
  expect(() => applyAutocomplete(request, { ...result, end: 10 }, result.items[0])).toThrow(RangeError)
  expect(() => applyAutocomplete({ text: "😀", cursor: 1 }, result, result.items[0])).toThrow(RangeError)
})

test("cancels superseded requests and ignores out-of-order results", async () => {
  const pending: { request: AutocompleteRequest; signal: AbortSignal; resolve: (value: AutocompleteResult) => void }[] = []
  const controller = new AutocompleteController((request, signal) => new Promise((resolve) => {
    pending.push({ request, signal, resolve })
  }))
  const first = controller.request({ text: "a", cursor: 1 })
  const second = controller.request({ text: "b", cursor: 1 })
  expect(pending[0].signal.aborted).toBe(true)
  const result = (index: number): AutocompleteResult => ({ request: pending[index].request, start: 0, end: 1, items: [] })
  pending[1].resolve(result(1))
  expect(await second).toEqual(result(1))
  pending[0].resolve(result(0))
  expect(await first).toBeNull()
  const third = controller.request({ text: "c", cursor: 1 })
  controller.dispose()
  expect(pending[2].signal.aborted).toBe(true)
  pending[2].resolve(result(2))
  expect(await third).toBeNull()
  expect(await controller.request({ text: "d", cursor: 1 })).toBeNull()
})

test("surfaces real provider errors and suppresses errors from cancelled work", async () => {
  const error = new Error("provider failed")
  const controller = new AutocompleteController(() => { throw error })
  await expect(controller.request({ text: "a", cursor: 1 })).rejects.toBe(error)
  const cancelled = new AutocompleteController((_request, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(error), { once: true })
  }))
  const request = cancelled.request({ text: "a", cursor: 1 })
  cancelled.cancel()
  expect(await request).toBeNull()
})

test("rejects a provider result for a different snapshot", async () => {
  const controller = new AutocompleteController(() => ({
    request: { text: "other", cursor: 5 }, start: 0, end: 5, items: [],
  }))
  await expect(controller.request({ text: "query", cursor: 5 })).rejects.toThrow("stale result")
})

test("composes providers in explicit priority order and honors cancellation", async () => {
  let fallback = 0
  const provider = combineAutocompleteProviders(createSlashCommandProvider([{ name: "help" }]), () => {
    fallback++
    return null
  })
  expect((await provider({ text: "/x", cursor: 2 }, signal))?.items).toEqual([])
  expect(fallback).toBe(0)
  expect(await provider({ text: "file", cursor: 4 }, signal)).toBeNull()
  expect(fallback).toBe(1)
  expect(await provider({ text: "file", cursor: 4 }, AbortSignal.abort())).toBeNull()
  expect(fallback).toBe(1)
})

test("file completion replaces a full token, sorts directories first, and quotes spaces", async () => {
  const provider = createFilePathProvider({ cwd: await fixture() })
  const request = { text: "open ./fZZ tail", cursor: 8 }
  const result = (await provider(request, signal))!
  expect(result.items.map((item) => item.label)).toEqual(["folder/", "file name.ts", "file.ts"])
  expect(applyAutocomplete(request, result, result.items[1])).toEqual({ text: 'open "./file name.ts" tail', cursor: 21 })
})

test("file completion supports quoted @paths, Unicode, home and parent directories", async () => {
  const cwd = await fixture()
  const provider = createFilePathProvider({ cwd: path.join(cwd, "folder"), home: cwd })
  for (const prefix of ["~/", "../"]) {
    const request = { text: `中文😀 @"${prefix}file n`, cursor: `中文😀 @"${prefix}file n`.length }
    const result = (await provider(request, signal))!
    expect(result.items[0].insertText).toBe(`@"${prefix}file name.ts"`)
    const applied = applyAutocomplete(request, result, result.items[0])!
    expect(applied.text).toBe(`中文😀 @"${prefix}file name.ts"`)
    expect(applied.cursor).toBe(applied.text.length)
  }
  const request = { text: "../中文", cursor: 5 }
  expect((await provider(request, signal))?.items[0].label).toBe("中文😀.ts")
})

test("file completion handles closed quotes and preserves following text", async () => {
  const provider = createFilePathProvider({ cwd: await fixture() })
  const request = { text: '"file n" tail', cursor: 7 }
  const result = (await provider(request, signal))!
  expect(applyAutocomplete(request, result, result.items[0])?.text).toBe('"file name.ts" tail')
  const afterQuote = { ...request, cursor: 8 }
  expect((await provider(afterQuote, signal))?.items[0].insertText).toBe('"file name.ts"')
})

test("quoted directory completion leaves the caret inside the quotes for continued typing", async () => {
  const cwd = await fixture()
  await mkdir(path.join(cwd, "my dir"))
  await writeFile(path.join(cwd, "my dir", "child.ts"), "")
  const provider = createFilePathProvider({ cwd })
  const request = { text: "my", cursor: 2 }
  const result = (await provider(request, signal))!
  const applied = applyAutocomplete(request, result, result.items[0])!
  expect(applied).toEqual({ text: '"my dir/"', cursor: 8 })
  const next = { text: applied.text.slice(0, applied.cursor) + "ch" + applied.text.slice(applied.cursor), cursor: 10 }
  const children = (await provider(next, signal))!
  expect(applyAutocomplete(next, children, children.items[0])?.text).toBe('"my dir/child.ts"')
})

test("file completion recognizes directory symlinks without recursive traversal", async () => {
  const cwd = await fixture()
  await symlink(path.join(cwd, "folder"), path.join(cwd, "link"), process.platform === "win32" ? "junction" : "dir")
  const result = (await createFilePathProvider({ cwd })({ text: "li", cursor: 2 }, signal))!
  expect(result.items[0]).toMatchObject({ label: "link/", insertText: "link/", description: "Directory" })
})

test.skipIf(process.platform !== "win32")("file completion supports Windows separators, drive paths and home", async () => {
  const cwd = await fixture()
  const provider = createFilePathProvider({ cwd, home: cwd })
  for (const prefix of [".\\", "~\\", cwd + "\\"]) {
    const text = '"' + prefix + 'fol"'
    const result = (await provider({ text, cursor: text.length - 1 }, signal))!
    expect(result.items[0].insertText).toBe('"' + prefix + 'folder\\"')
  }
})

test("file completion handles missing directories, hidden files, bounded results and aborts", async () => {
  const cwd = await fixture()
  const provider = createFilePathProvider({ cwd, maxResults: 2 })
  expect((await provider({ text: "./", cursor: 2 }, signal))?.items).toHaveLength(2)
  expect((await provider({ text: ".h", cursor: 2 }, signal))?.items[0].label).toBe(".hidden")
  expect(await provider({ text: "./missing/x", cursor: 11 }, signal)).toBeNull()
  expect(await provider({ text: "./", cursor: 2 }, AbortSignal.abort())).toBeNull()
  expect(() => createFilePathProvider({ maxResults: 0 })).toThrow(RangeError)
})

test.skipIf(process.platform === "win32")("file completion excludes terminal controls and unrepresentable quotes", async () => {
  const cwd = await fixture()
  await writeFile(path.join(cwd, 'bad"name'), "")
  await writeFile(path.join(cwd, "bad\x1b[31m"), "")
  const result = await createFilePathProvider({ cwd })({ text: "bad", cursor: 3 }, signal)
  expect(result?.items).toEqual([])
})


test("a replacement request does not start work after an abort callback disposes the controller", async () => {
  const calls: string[] = []
  const controller = new AutocompleteController((request, signal) => {
    calls.push(request.text)
    signal.addEventListener("abort", () => controller.dispose(), { once: true })
    return { request, start: 0, end: request.cursor, items: [] }
  })
  const first = controller.request({ text: "first", cursor: 5 })
  const replacement = controller.request({ text: "replacement", cursor: 11 })
  expect(await first).toBeNull()
  expect(await replacement).toBeNull()
  expect(calls).toEqual(["first"])
})

test("requests started by abort callbacks supersede the request that triggered cancellation", async () => {
  const calls: string[] = []
  let latest: Promise<AutocompleteResult | null> | undefined
  const controller = new AutocompleteController((request, signal) => {
    calls.push(request.text)
    if (request.text === "first") {
      signal.addEventListener("abort", () => {
        latest = controller.request({ text: "latest", cursor: 6 })
      }, { once: true })
    }
    return { request, start: 0, end: request.cursor, items: [] }
  })
  const first = controller.request({ text: "first", cursor: 5 })
  const replacement = controller.request({ text: "replacement", cursor: 11 })
  expect(await first).toBeNull()
  expect(await replacement).toBeNull()
  expect((await latest)?.request.text).toBe("latest")
  expect(calls).toEqual(["first", "latest"])
  controller.dispose()
})

test("cancel preserves a new request started by the cancelled provider's abort callback", async () => {
  let latest: Promise<AutocompleteResult | null> | undefined
  let latestSignal: AbortSignal | undefined
  const controller = new AutocompleteController((request, signal) => {
    if (request.text === "first") {
      signal.addEventListener("abort", () => {
        latest = controller.request({ text: "latest", cursor: 6 })
      }, { once: true })
    } else latestSignal = signal
    return { request, start: 0, end: request.cursor, items: [] }
  })
  const first = controller.request({ text: "first", cursor: 5 })
  controller.cancel()
  expect(await first).toBeNull()
  expect(latestSignal?.aborted).toBe(false)
  expect((await latest)?.request.text).toBe("latest")
  controller.dispose()
})
