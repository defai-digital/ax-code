import { describe, expect, test } from "vitest"
import { parseShellArgs } from "../../src/util/shell-args"

describe("parseShellArgs", () => {
  test("splits ordinary whitespace separated arguments", () => {
    expect(parseShellArgs("node server.js --stdio")).toEqual(["node", "server.js", "--stdio"])
  })

  test("preserves quoted argument groups", () => {
    expect(parseShellArgs("node server.js --root \"My Project\" --name='local mcp'")).toEqual([
      "node",
      "server.js",
      "--root",
      "My Project",
      "--name=local mcp",
    ])
  })

  test("preserves empty quoted arguments", () => {
    expect(parseShellArgs('cmd "" "non empty"')).toEqual(["cmd", "", "non empty"])
  })

  test("handles escaped spaces and trailing backslashes", () => {
    expect(parseShellArgs("cmd one\\ two path\\")).toEqual(["cmd", "one two", "path\\"])
  })

  test("keeps backslash-escaped quotes inside double quotes", () => {
    expect(parseShellArgs('aws --query "\\" describe \\"" ec2 terminate-instances --instance-ids i-1')).toEqual([
      "aws",
      "--query",
      '" describe "',
      "ec2",
      "terminate-instances",
      "--instance-ids",
      "i-1",
    ])
  })

  test("escapes backslash, dollar, and backtick inside double quotes", () => {
    expect(parseShellArgs('echo "a\\\\b" "\\$HOME" "\\`id\\`"')).toEqual(["echo", "a\\b", "$HOME", "`id`"])
  })

  test("keeps backslashes literal before ordinary characters inside double quotes", () => {
    expect(parseShellArgs('echo "a\\nb" "C:\\Users"')).toEqual(["echo", "a\\nb", "C:\\Users"])
  })

  test("drops backslash-newline inside double quotes and as a line continuation outside quotes", () => {
    expect(parseShellArgs('echo "a\\\nb"')).toEqual(["echo", "ab"])
    expect(parseShellArgs("echo a\\\nb")).toEqual(["echo", "ab"])
  })

  test("keeps backslashes and double quotes literal inside single quotes", () => {
    expect(parseShellArgs("echo 'a\\b' '\"'")).toEqual(["echo", "a\\b", '"'])
  })

  test("parses backslash-escaped quotes in a git -c value", () => {
    expect(parseShellArgs('git -c "a.b=\\"" reset --hard "\\""')).toEqual([
      "git",
      "-c",
      'a.b="',
      "reset",
      "--hard",
      '"',
    ])
  })
})
