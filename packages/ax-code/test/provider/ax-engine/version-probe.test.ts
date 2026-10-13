import { afterEach, expect, test, vi } from "vitest"
import { Process } from "../../../src/util/process"
import { probeVersion } from "../../../src/provider/ax-engine/version-probe"

function response(text: string, stderr = "", code = 0): Process.TextResult {
  return { code, text, stdout: Buffer.from(text), stderr: Buffer.from(stderr) }
}

afterEach(() => vi.restoreAllMocks())

test("ignores numeric startup diagnostics before the version line", async () => {
  vi.spyOn(Process, "text").mockResolvedValue(response("Warning: using 8 threads\nax-engine 7.5.5\n"))
  expect(await probeVersion("ax-engine")).toBe("ax-engine 7.5.5")
})

test("reads a version on stderr even when stdout contains diagnostics", async () => {
  vi.spyOn(Process, "text").mockResolvedValue(response("Warning: runtime initialization", "7.5.5\n"))
  expect(await probeVersion("ax-engine")).toBe("7.5.5")
})

test("falls back to doctor instead of coercing an unrelated version", async () => {
  const probe = vi
    .spyOn(Process, "text")
    .mockImplementation(async (args) =>
      args[1] === "--version"
        ? response("Python 3.14.0; Metal 4.0")
        : response('{"install":{"version":"7.5.5"}}', "", 1),
    )
  expect(await probeVersion("ax-engine")).toBe("7.5.5")
  expect(probe).toHaveBeenCalledTimes(2)
})

test("does not infer an engine version from an unrelated tool banner", async () => {
  vi.spyOn(Process, "text").mockResolvedValue(response("Python 3.14.0"))
  expect(await probeVersion("ax-engine")).toBeUndefined()
})

test.each(["release 99.0.0", "99.0.0 invalid", "Python 99.0.0"])(
  "rejects malformed doctor install.version: %s",
  async (version) => {
    vi.spyOn(Process, "text").mockImplementation(async (args) =>
      args[1] === "--version" ? response("", "", 2) : response(JSON.stringify({ install: { version } })),
    )
    expect(await probeVersion("ax-engine")).toBeUndefined()
  },
)

test.each([
  'WARN {cache miss}\n{"install":{"version":"7.7.0"}}',
  '{\n"install": {"version":"7.7.0"}\n} done {ok}',
  'WARN {cache miss}\n{"warning":"braces { and } inside strings","install":{"version":"7.7.0"}}',
])("reads doctor versions surrounded by brace-containing diagnostics: %s", async (text) => {
  vi.spyOn(Process, "text").mockImplementation(async (args) =>
    args[1] === "--version" ? response("", "", 2) : response(text),
  )
  expect(await probeVersion("ax-engine")).toBe("7.7.0")
})

test.each([
  ["99.0.0\nax-engine 7.7.0\n", ""],
  ["0.0.1\nax-engine 7.7.0\n", ""],
  ["99.0.0\n", "ax-engine 7.7.0\n"],
])("prefers the engine banner over unrelated bare versions: %s / %s", async (text, stderr) => {
  vi.spyOn(Process, "text").mockResolvedValue(response(text, stderr))
  expect(await probeVersion("ax-engine")).toBe("ax-engine 7.7.0")
})

test.each(['note { pending\n{"install":{"version":"7.7.0"}}', '{"msg": "say "hi"}\n{"install":{"version":"7.7.0"}}'])(
  "reads a complete doctor JSON line after malformed diagnostic braces: %s",
  async (text) => {
    vi.spyOn(Process, "text").mockImplementation(async (args) =>
      args[1] === "--version" ? response("", "", 2) : response(text),
    )
    expect(await probeVersion("ax-engine")).toBe("7.7.0")
  },
)
