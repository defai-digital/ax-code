import { expect, test } from "vitest"
import { seedRuntimeFlags } from "../../src/runtime/flags"

test.each([
  { pid: 42, preservePid: false, previous: "parent", expected: "42" },
  { pid: 42, preservePid: true, previous: "parent", expected: "parent" },
  { pid: 42, preservePid: true, previous: undefined, expected: "42" },
  { pid: 42, preservePid: true, previous: "", expected: "" },
  { pid: 0, preservePid: false, previous: "parent", expected: "0" },
])("runtime flags preserve the caller's PID choice: $preservePid / $previous", (input) => {
  const env: Record<string, string | undefined> = { AX_CODE_PID: input.previous, HOST_VALUE: "untouched" }
  seedRuntimeFlags(env, { pid: input.pid, preservePid: input.preservePid })
  expect(env).toEqual({
    AGENT: "1",
    AX_CODE: "1",
    OPENCODE: "1",
    AX_CODE_PID: input.expected,
    HOST_VALUE: "untouched",
  })
})
