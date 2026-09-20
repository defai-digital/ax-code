import { beforeAll, afterAll, describe, expect, test, vi } from "vitest"
import { createRequire } from "node:module"
import { Parser, Language } from "web-tree-sitter"
import fs from "node:fs/promises"
import path from "node:path"
import { assertValidationPipeline } from "../../src/tool/bash-validation-pipeline"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { SessionID, MessageID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

const require = createRequire(import.meta.url)
let parser: Parser
beforeAll(async () => {
  await Parser.init({ locateFile: () => require.resolve("web-tree-sitter/tree-sitter.wasm") })
  parser = new Parser()
  parser.setLanguage(await Language.load(require.resolve("tree-sitter-bash/tree-sitter-bash.wasm")))
})
afterAll(() => parser.delete())
function inspect(command: string) {
  const tree = parser.parse(command)!
  try {
    assertValidationPipeline(tree.rootNode)
  } finally {
    tree.delete()
  }
}

describe("validation output admission", () => {
  test.each([
    "cd /repo && timeout 300 pnpm --dir packages/ax-code run test:unit 2>&1 | tail -40",
    'timeout 300 pnpm --dir packages/ax-code run test:unit 2>&1 | grep -E "Tests|passed" | tail -20',
    "set -o pipefail; npm test | head -20",
    "pnpm --filter core run typecheck | tail -30",
    "env CI=1 timeout --signal TERM 3 pnpm exec vitest run | tail",
    '"/usr/bin/npm" run "test:unit" | tail',
    "vitest run | head",
    "pnpm -r test | tail",
    "pnpm -w test | tail",
    "npm -w core test | tail",
    "pnpm --silent test | tail",
    "./node_modules/.bin/vitest run | tail",
    "pytest | tail",
    "cargo test | tail",
    "go test ./... | tail",
    "tsc --noEmit 2>&1 | tail",
  ])("rejects lossy check: %s", (command) => {
    expect(() => inspect(command)).toThrow("No command ran")
  })
  test.each([
    "pnpm --dir packages/ax-code run test:unit",
    "set -o pipefail; pnpm test | tee tests.log",
    "cat tests.log | tail -40",
    "git log --oneline | head -5",
    'printf "%s" "pnpm test | tail"',
    'pnpm exec node -e "console.log(1)" | tail',
    "pnpm --dir test list | tail",
    "npm view test version | tail",
    "pnpm test && tail -40 tests.log",
    "pnpm test && echo done | tail",
    "cd /repo && cat tests.log 2>&1 | tail",
    "pnpm test | grep -q passed",
    "pytest --help | head",
    "pnpm exec vitest --version | tail",
  ])("preserves ordinary command: %s", (command) => {
    expect(() => inspect(command)).not.toThrow()
  })

  test.each([false, true])("rejects before any side effect, background=%s", async (background) => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const ask = vi.fn()
        await expect(
          bash.execute(
            { command: "touch sentinel; timeout 1 npm test | tail -1", run_in_background: background },
            {
              sessionID: SessionID.make("ses_validation"),
              messageID: MessageID.make("msg_validation"),
              callID: "validation",
              agent: "build",
              abort: new AbortController().signal,
              messages: [],
              metadata: () => {},
              ask,
            },
          ),
        ).rejects.toThrow("No command ran")
        expect(ask).not.toHaveBeenCalled()
        await expect(fs.stat(path.join(tmp.path, "sentinel"))).rejects.toThrow()
      },
    })
  })
  test("checks a static shell wrapper before execution", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        await expect(
          bash.execute(
            { command: "bash -c 'touch sentinel; npm test | tail'" },
            {
              sessionID: SessionID.make("ses_validation"),
              messageID: MessageID.make("msg_validation"),
              callID: "validation",
              agent: "build",
              abort: new AbortController().signal,
              messages: [],
              metadata: () => {},
              ask: async () => {},
            },
          ),
        ).rejects.toThrow("No command ran")
        await expect(fs.stat(path.join(tmp.path, "sentinel"))).rejects.toThrow()
      },
    })
  })
})
