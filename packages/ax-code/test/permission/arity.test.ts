import { test, expect } from "vitest"
import { BashArity } from "../../src/permission/arity"

test("arity 1 - unknown commands default to first token", () => {
  expect(BashArity.prefix(["unknown", "command", "subcommand"])).toEqual(["unknown"])
  expect(BashArity.prefix(["touch", "foo.txt"])).toEqual(["touch"])
})

test("arity 2 - two token commands", () => {
  expect(BashArity.prefix(["git", "checkout", "main"])).toEqual(["git", "checkout"])
  expect(BashArity.prefix(["docker", "run", "nginx"])).toEqual(["docker", "run"])
})

test("arity 3 - three token commands", () => {
  expect(BashArity.prefix(["aws", "s3", "ls", "my-bucket"])).toEqual(["aws", "s3", "ls"])
  expect(BashArity.prefix(["npm", "run", "dev", "script"])).toEqual(["npm", "run", "dev"])
})

test("longest match wins - nested prefixes", () => {
  expect(BashArity.prefix(["docker", "compose", "up", "service"])).toEqual(["docker", "compose", "up"])
  expect(BashArity.prefix(["consul", "kv", "get", "config"])).toEqual(["consul", "kv", "get"])
})

test("exact length matches", () => {
  expect(BashArity.prefix(["git", "checkout"])).toEqual(["git", "checkout"])
  expect(BashArity.prefix(["npm", "run", "dev"])).toEqual(["npm", "run", "dev"])
})

test("edge cases", () => {
  expect(BashArity.prefix([])).toEqual([])
  expect(BashArity.prefix(["single"])).toEqual(["single"])
  expect(BashArity.prefix(["git"])).toEqual(["git"])
})

test("flags never count as tokens", () => {
  // A leading global flag must not widen the always grant to every
  // subcommand behind the same flag: approving `git --no-pager log` once
  // must grant "git --no-pager log *", not "git --no-pager *".
  expect(BashArity.prefix(["git", "--no-pager", "log"])).toEqual(["git", "--no-pager", "log"])
  expect(BashArity.prefix(["git", "-C", "/tmp", "checkout", "."])).toEqual(["git", "-C", "/tmp", "checkout"])
  expect(BashArity.prefix(["git", "-c", "user.name=x", "commit", "-m", "hi"])).toEqual([
    "git",
    "-c",
    "user.name=x",
    "commit",
  ])
  expect(BashArity.prefix(["docker", "-H", "tcp://remote:2375", "ps"])).toEqual([
    "docker",
    "-H",
    "tcp://remote:2375",
    "ps",
  ])
  expect(BashArity.prefix(["python", "-m", "http.server"])).toEqual(["python", "-m", "http.server"])
  // Flag positions are preserved so the pattern still matches the exact
  // command text the user approved.
  expect(BashArity.prefix(["git", "--no-pager", "log"]).join(" ") + " *").toBe("git --no-pager log *")
})

test("prototype-chain names do not produce a degenerate empty prefix", () => {
  expect(BashArity.prefix(["toString", "foo"])).toEqual(["toString"])
  expect(BashArity.prefix(["constructor", "x"])).toEqual(["constructor"])
  expect(BashArity.prefix(["__proto__", "y"])).toEqual(["__proto__"])
})
