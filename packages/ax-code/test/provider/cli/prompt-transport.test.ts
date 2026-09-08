import { afterEach, describe, expect, test, vi } from "vitest"
import { createHash } from "node:crypto"
import { ChildProcess } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { CliLanguageModel } from "../../../src/provider/cli/cli-language-model"
import { CLI_PROVIDER_DEFINITIONS } from "../../../src/provider/cli/config"
import { promptToText } from "../../../src/provider/cli/prompt"
import { Process } from "../../../src/util/process"
import * as transport from "../../../src/provider/cli/prompt-transport"
import { Shell } from "../../../src/shell/shell"
import { PassThrough } from "node:stream"
import { MessageV2 } from "../../../src/session/message-v2"
import { SessionID } from "../../../src/session/schema"
import { ModelID, ProviderID } from "../../../src/provider/schema"
import { handlePromptLoopError } from "../../../src/session/prompt-loop-errors"
import { tmpdir } from "../../fixture/fixture"
import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from "@ai-sdk/provider"

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const prompt: LanguageModelV3CallOptions["prompt"] = [
  { role: "system", content: "Preserve all input, including the final marker." },
  {
    role: "user",
    content: [
      { type: "text", text: 'Line with "quotes", \\slashes, and \u{1f680}.\n'.repeat(12_000) + "FINAL_MARKER" },
    ],
  },
]

function model(providerID: string) {
  return new CliLanguageModel({
    ...CLI_PROVIDER_DEFINITIONS[providerID]!,
    providerID,
    modelID: providerID,
    parser: {
      parseComplete: (text) => ({ text: text.trim() }),
      parseStreamLine: (line) => line,
    },
  })
}

async function collect(stream: ReadableStream<LanguageModelV3StreamPart>) {
  const parts: LanguageModelV3StreamPart[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
  }
  return parts
}

describe.each(["doGenerate", "doStream"] as const)("%s prompt transport", (method) => {
  test.each(["claude-code", "codex-cli", "grok-build-cli"])(
    "%s delivers the complete large prompt without putting it in argv",
    async (providerID) => {
      await using tmp = await tmpdir()
      const script = path.join(tmp.path, "read-prompt.cjs")
      await writeFile(
        script,
        `const fs = require("node:fs");
const crypto = require("node:crypto");
const args = process.argv.slice(2);
const fileFlag = args.indexOf("--prompt-file");
const input = fs.readFileSync(fileFlag === -1 ? 0 : args[fileFlag + 1]);
process.stdout.write(crypto.createHash("sha256").update(input).digest("hex") + "\\n");
`,
      )
      const expected = promptToText(prompt, { providerID })
      const hash = createHash("sha256").update(expected).digest("hex")
      const spawnProcess = Process.spawn
      let promptFile: string | undefined
      const spawn = vi.spyOn(Process, "spawn").mockImplementation((cmd, opts) => {
        // Reproduce a Windows-sized argv ceiling even on Unix CI hosts.
        if (cmd.join(" ").length > 32_767) {
          throw Object.assign(new Error("spawn ENAMETOOLONG"), { code: "ENAMETOOLONG" })
        }
        expect(cmd).not.toContain(expected)
        if (providerID === "grok-build-cli") {
          expect(cmd).not.toContain("-p")
          const flag = cmd.indexOf("--prompt-file")
          expect(flag).toBeGreaterThan(0)
          promptFile = cmd[flag + 1]!
          expect(readFileSync(promptFile, "utf8")).toBe(expected)
          if (process.platform !== "win32") {
            expect(statSync(promptFile).mode & 0o777).toBe(0o600)
            expect(statSync(path.dirname(promptFile)).mode & 0o777).toBe(0o700)
          }
        } else {
          expect(opts?.stdin).toBe("pipe")
        }
        return spawnProcess([process.execPath, script, ...cmd.slice(1)], opts)
      })
      const cli = model(providerID)
      if (method === "doGenerate") {
        const result = await cli.doGenerate({ prompt })
        expect(result.content).toEqual([{ type: "text", text: hash }])
      } else {
        const parts = await collect((await cli.doStream({ prompt })).stream)
        expect(parts.filter((part) => part.type === "error")).toEqual([])
        expect(parts.find((part) => part.type === "finish")).toBeDefined()
        expect(
          parts
            .filter((part) => part.type === "text-delta")
            .map((part) => part.delta)
            .join("")
            .trim(),
        ).toBe(hash)
      }
      expect(spawn).toHaveBeenCalledTimes(1)
      if (promptFile) {
        await vi.waitFor(() => expect(existsSync(path.dirname(promptFile!))).toBe(false))
      }
    },
  )

  test("rejects oversized Kimi argv before spawn with a non-retryable, actionable error", async () => {
    const spawn = vi.spyOn(Process, "spawn").mockImplementation(() => {
      throw new Error("Unexpected CLI launch")
    })
    await expect(model("kimi-cli")[method]({ prompt })).rejects.toMatchObject({
      isRetryable: false,
      message: expect.stringMatching(/kimi-cli.*command.line.*codex-cli/i),
    })
    expect(spawn).not.toHaveBeenCalled()
  })

  test.each(["synchronous", "asynchronous"])("cleans prompt and attachments after %s spawn failure", async (kind) => {
    let promptFile: string | undefined
    let attachmentFile: string | undefined
    const failure = Object.assign(new Error("spawn failed"), { code: "ENOENT" })
    vi.spyOn(Process, "spawn").mockImplementation((cmd) => {
      promptFile = cmd[cmd.indexOf("--prompt-file") + 1]!
      const text = readFileSync(promptFile, "utf8")
      attachmentFile = text.match(/^- (.+) \(text\/plain\)$/m)?.[1]
      expect(attachmentFile).toBeDefined()
      expect(existsSync(attachmentFile!)).toBe(true)
      if (kind === "synchronous") throw failure
      const stdout = new PassThrough()
      const stderr = new PassThrough()
      stdout.end()
      stderr.end()
      return Object.assign(new ChildProcess(), {
        stdin: null,
        stdout,
        stderr,
        exited: Promise.reject(failure),
        exitCode: null,
        signalCode: null,
      })
    })
    const options: LanguageModelV3CallOptions = {
      prompt: [{ role: "user", content: [{ type: "file", data: Buffer.from("attachment"), mediaType: "text/plain" }] }],
    }
    if (method === "doStream" && kind === "asynchronous") {
      const parts = await collect((await model("grok-build-cli").doStream(options)).stream)
      expect(parts.find((part) => part.type === "error")).toMatchObject({ error: failure })
    } else {
      await expect(model("grok-build-cli")[method](options)).rejects.toBe(failure)
    }
    expect(promptFile).toBeDefined()
    expect(existsSync(path.dirname(promptFile!))).toBe(false)
    expect(existsSync(path.dirname(attachmentFile!))).toBe(false)
  })

  test("cancellation during prompt preparation cleans the file without launching", async () => {
    const controller = new AbortController()
    const materialize = transport.materializeCliPrompt
    let file: string | undefined
    vi.spyOn(transport, "materializeCliPrompt").mockImplementation(async (text) => {
      const resource = await materialize(text)
      file = resource.file
      controller.abort()
      return resource
    })
    const spawn = vi.spyOn(Process, "spawn").mockImplementation(() => {
      throw new Error("Unexpected CLI launch")
    })
    await expect(model("grok-build-cli")[method]({ prompt, abortSignal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    })
    expect(spawn).not.toHaveBeenCalled()
    expect(file).toBeDefined()
    expect(existsSync(path.dirname(file!))).toBe(false)
  })

  test("keeps the prompt until an aborted child exits, then cleans it", async () => {
    const controller = new AbortController()
    let file: string | undefined
    let resolveExit: (code: number) => void = () => {}
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve
    })
    vi.spyOn(Process, "spawn").mockImplementation((cmd) => {
      file = cmd[cmd.indexOf("--prompt-file") + 1]!
      return Object.assign(new ChildProcess(), {
        stdin: null,
        stdout,
        stderr,
        exited,
        exitCode: null,
        signalCode: null,
      })
    })
    const kill = vi.spyOn(Shell, "killTree").mockImplementation(async () => {
      expect(existsSync(file!)).toBe(true)
      stdout.end()
      stderr.end()
      resolveExit(143)
    })
    const cli = model("grok-build-cli")
    if (method === "doGenerate") {
      const result = cli.doGenerate({ prompt, abortSignal: controller.signal })
      const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" })
      await vi.waitFor(() => expect(file).toBeDefined())
      controller.abort()
      await rejected
    } else {
      const { stream } = await cli.doStream({ prompt, abortSignal: controller.signal })
      controller.abort()
      const parts = await collect(stream)
      expect(parts.find((part) => part.type === "error")).toMatchObject({ error: { name: "AbortError" } })
    }
    expect(kill).toHaveBeenCalledTimes(1)
    expect(existsSync(path.dirname(file!))).toBe(false)
  })
})

test("Windows argv guard accounts for shim escaping and returns no prompt content", () => {
  const secretPrompt = 'private "prompt" & value '.repeat(200)
  const cmd = ["C:\\Program Files\\Kimi\\kimi.cmd", "-p", secretPrompt]
  expect(() => transport.assertCliCommandSize(cmd, "kimi-cli", "win32")).toThrow(/command line/)
  expect(() => transport.assertCliCommandSize(["kimi", "-p", '"'.repeat(1_800)], "kimi-cli", "win32")).toThrow(
    /command line/,
  )
  expect(() => transport.assertCliCommandSize(["kimi", "-p", "\x60".repeat(2_100)], "kimi-cli", "win32")).toThrow(
    /command line/,
  )
  expect(() => transport.assertCliCommandSize(["kimi", "-p", "short prompt"], "kimi-cli", "win32")).not.toThrow()
  try {
    transport.assertCliCommandSize(cmd, "kimi-cli", "win32")
  } catch (error) {
    expect(error).toMatchObject({ isRetryable: false, requestBodyValues: undefined })
    expect(String(error)).not.toContain(secretPrompt)
  }
})

test("oversized Kimi prompts remain terminal after session error serialization", async () => {
  const spawn = vi.spyOn(Process, "spawn").mockImplementation(() => {
    throw new Error("Unexpected CLI launch")
  })
  const providerID = ProviderID.make("kimi-cli")
  const findFallback = vi.fn()
  const publishError = vi.fn()
  const failure = await model(providerID)
    .doGenerate({ prompt })
    .catch((error: unknown) => error)
  const error = MessageV2.fromError(failure, { providerID })
  expect(error).toMatchObject({ name: "APIError", data: { isRetryable: false } })
  const result = await handlePromptLoopError(
    {
      sessionID: SessionID.descending(),
      currentModel: { providerID, modelID: ModelID.make("kimi-code/k3") },
      error,
      consecutiveErrors: 1,
      step: 1,
    },
    { findFallback, publishError, warn() {} },
  )
  expect(result).toEqual({ action: "stop", reason: "error", consecutiveErrors: 1 })
  expect(findFallback).not.toHaveBeenCalled()
  expect(publishError).toHaveBeenCalledTimes(1)
  expect(spawn).not.toHaveBeenCalled()
})

test("Grok prompt files retain structured output instructions and clean up after nonzero exit", async () => {
  let file: string | undefined
  vi.spyOn(Process, "spawn").mockImplementation((cmd) => {
    file = cmd[cmd.indexOf("--prompt-file") + 1]!
    const text = readFileSync(file, "utf8")
    expect(text).toContain("FINAL_MARKER")
    expect(text).toContain("<json_output>")
    expect(text).toContain('"answer":{"type":"string"}')
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    stdout.end()
    stderr.end("provider rejected request")
    return Object.assign(new ChildProcess(), { stdout, stderr, exited: Promise.resolve(9) })
  })
  await expect(
    model("grok-build-cli").doGenerate({
      prompt,
      responseFormat: { type: "json", schema: { type: "object", properties: { answer: { type: "string" } } } },
    }),
  ).rejects.toThrow(/CLI exited with code 9: provider rejected request/)
  expect(file).toBeDefined()
  expect(existsSync(path.dirname(file!))).toBe(false)
})

test("cancelling a Grok stream kills its process and removes its prompt file", async () => {
  let file: string | undefined
  let resolveExit: (code: number) => void = () => {}
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve
  })
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  vi.spyOn(Process, "spawn").mockImplementation((cmd) => {
    file = cmd[cmd.indexOf("--prompt-file") + 1]!
    return Object.assign(new ChildProcess(), { stdout, stderr, exited })
  })
  const kill = vi.spyOn(Shell, "killTree").mockImplementation(async () => {
    expect(existsSync(file!)).toBe(true)
    resolveExit(143)
    stdout.end()
    stderr.end()
  })
  const { stream } = await model("grok-build-cli").doStream({ prompt })
  await stream.cancel()
  expect(kill).toHaveBeenCalledTimes(1)
  await vi.waitFor(() => expect(existsSync(path.dirname(file!))).toBe(false))
})

test("an idle Grok stream timeout kills its process and removes its prompt file", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  let file: string | undefined
  let resolveExit: (code: number) => void = () => {}
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve
  })
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  vi.spyOn(Process, "spawn").mockImplementation((cmd) => {
    file = cmd[cmd.indexOf("--prompt-file") + 1]!
    return Object.assign(new ChildProcess(), { stdout, stderr, exited })
  })
  vi.spyOn(Shell, "killTree").mockImplementation(async () => {
    expect(existsSync(file!)).toBe(true)
    resolveExit(143)
    stdout.end()
    stderr.end()
  })
  const { stream } = await model("grok-build-cli").doStream({ prompt })
  const collected = collect(stream)
  await vi.advanceTimersByTimeAsync(300_000)
  const parts = await collected
  expect(parts.find((part) => part.type === "error")).toMatchObject({
    error: { message: expect.stringContaining("timed out") },
  })
  vi.useRealTimers()
  await vi.waitFor(() => expect(existsSync(path.dirname(file!))).toBe(false))
})
