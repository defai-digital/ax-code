import { afterEach, expect, test, vi } from "vitest"
import yargs from "yargs"
import { RunCommand } from "../../src/cli/cmd/run"

afterEach(() => vi.restoreAllMocks())

// `run --port` is accepted for compatibility but nothing reads it: the
// non-attach path hosts the server in-process and never binds a port. The flag
// is therefore declared deprecated and warns instead of silently doing nothing.
test("--port is declared deprecated and names the flags that do bind a port", async () => {
  const built = (RunCommand.builder as (argv: unknown) => unknown)(yargs()) as {
    getDeprecatedOptions(): Record<string, string | boolean | undefined>
    getHelp(): string | Promise<string>
  }
  // yargs keeps deprecation notices in their own map, not in the option record.
  const deprecation = built.getDeprecatedOptions().port

  expect(deprecation).toBeTruthy()
  expect(String(deprecation)).toContain("ax-code serve --port")

  // Collapse help wrapping so the assertions are width-independent. The flag
  // stays documented (still accepted for compatibility) and carries the notice.
  const help = String(await built.getHelp()).replace(/\s+/g, " ")
  expect(help).toContain("--port")
  expect(help).toContain("[deprecated")
  expect(help).toContain("ax-code serve --port <n>")
  expect(help).toContain("ax-code run --attach <url>")
})

async function capturePortNotice(args: Record<string, unknown>) {
  const chunks: string[] = []
  const write = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    chunks.push(String(chunk))
    return true
  }) as never)
  const previousExitCode = process.exitCode
  try {
    // `timeout: 0` fails validation right after args are first handled, so the
    // notice is observable without reaching the server or a session.
    await expect(RunCommand.handler({ "--": [], timeout: 0, ...args } as never)).rejects.toMatchObject({
      name: "UICancelledError",
    })
    return chunks.join("")
  } finally {
    write.mockRestore()
    process.exitCode = previousExitCode
  }
}

test("run warns on stderr that --port is ignored", async () => {
  const output = await capturePortNotice({ port: 3000 })

  expect(output).toContain("--port is ignored by run")
  expect(output).toContain("ax-code serve --port <n>")
  expect(output).toContain("ax-code run --attach <url>")
})

test("run stays quiet about --port under --quiet", async () => {
  const output = await capturePortNotice({ port: 3000, quiet: true })

  expect(output).not.toContain("--port is ignored by run")
})

test("run says nothing when --port is absent", async () => {
  const output = await capturePortNotice({})

  expect(output).not.toContain("--port is ignored by run")
})
