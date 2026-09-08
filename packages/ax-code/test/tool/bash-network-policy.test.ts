import { describe, expect, test } from "vitest"
import { Isolation } from "../../src/isolation"
import { BashNetworkHeuristics } from "../../src/tool/bash-network-heuristics"

const networkOffState: Isolation.State = { mode: "workspace-write", network: false, protected: [] }
const networkOnState: Isolation.State = { mode: "workspace-write", network: true, protected: [] }
const fullAccessState: Isolation.State = { mode: "full-access", network: false, protected: [] }

describe("bash network heuristics (busybox, interpreters, containers)", () => {
  test("busybox applets are unfolded to the applet name", () => {
    expect(BashNetworkHeuristics.inspect("busybox", ["wget", "https://example.com"])).toMatchObject({
      applet: "wget",
    })
    expect(BashNetworkHeuristics.inspect("busybox", ["ls", "-l"])).toMatchObject({ applet: "ls" })
    expect(BashNetworkHeuristics.inspect("busybox", ["--help"]).applet).toBeUndefined()
  })

  test("interpreter inline code with network indicators is suspect", () => {
    expect(
      BashNetworkHeuristics.inspect("python", ["-c", "import urllib.request; urllib.request.urlopen('http://x')"]),
    ).toMatchObject({ inlineCodeNetworkSuspect: true })
    expect(BashNetworkHeuristics.inspect("node", ["-e", 'fetch("http://x")'])).toMatchObject({
      inlineCodeNetworkSuspect: true,
    })
    expect(BashNetworkHeuristics.inspect("perl", ["-e", 'use LWP::Simple; get("http://x")'])).toMatchObject({
      inlineCodeNetworkSuspect: true,
    })
    expect(BashNetworkHeuristics.inspect("ruby", ["-e", 'require "net/http"'])).toMatchObject({
      inlineCodeNetworkSuspect: true,
    })
  })

  test("offline interpreter one-liners stay unsuspicious", () => {
    expect(BashNetworkHeuristics.inspect("python", ["-c", "print(sum(range(10)))"])).toMatchObject({
      inlineCodeNetworkSuspect: false,
    })
    expect(BashNetworkHeuristics.inspect("node", ["script.js"])).toMatchObject({
      inlineCodeNetworkSuspect: false,
    })
  })

  test("interpreter flags with missing code are treated as opaque suspects", () => {
    expect(BashNetworkHeuristics.inspect("python", ["-c"]).inlineCodeNetworkSuspect).toBe(true)
    expect(BashNetworkHeuristics.inspect("node", ["--eval"]).inlineCodeNetworkSuspect).toBe(true)
  })

  test("container and namespace invocations are sandbox escapes", () => {
    expect(BashNetworkHeuristics.inspect("docker", ["run", "--rm", "alpine", "curl", "http://x"])).toMatchObject({
      sandboxEscapeSuspect: true,
    })
    expect(BashNetworkHeuristics.inspect("podman", ["run", "alpine"])).toMatchObject({
      sandboxEscapeSuspect: true,
    })
    expect(BashNetworkHeuristics.inspect("nsenter", ["-t", "1", "sh"])).toMatchObject({
      sandboxEscapeSuspect: true,
    })
    expect(BashNetworkHeuristics.inspect("unshare", ["-n", "sh"])).toMatchObject({
      sandboxEscapeSuspect: true,
    })
    // Non-run subcommands are not network escapes.
    expect(BashNetworkHeuristics.inspect("docker", ["ps"]).sandboxEscapeSuspect).toBe(false)
    expect(BashNetworkHeuristics.inspect("docker", ["build", "-t", "x", "."]).sandboxEscapeSuspect).toBe(false)
  })
})

describe("isolation.assertBashNetwork policy matrix", () => {
  const deny = (names: string[], opts?: { wrapperSuspect?: boolean }) =>
    Isolation.assertBashNetwork(networkOffState, names, opts)

  test("plain network commands are denied when network is off", () => {
    expect(() => deny(["curl"])).toThrow(/Network access is disabled/)
    expect(() => deny(["/usr/local/bin/wget"])).toThrow(/"wget" requires network access/)
  })

  test("busybox-unfolded applets are denied by applet name", () => {
    expect(() => deny(["busybox", "wget"])).toThrow(/"wget" requires network access/)
    expect(() => deny(["busybox", "nc"])).toThrow(/"nc" requires network access/)
  })

  test("wrapper suspects are denied with the wrapper explanation", () => {
    expect(() => deny(["python"], { wrapperSuspect: true })).toThrow(/wraps interpreted code/)
    expect(() => deny(["docker"], { wrapperSuspect: true })).toThrow(/container\/namespace tool/)
  })

  test("non-network commands pass when network is off", () => {
    expect(() => deny(["ls", "grep"])).not.toThrow()
    expect(() => deny(["python", "node"], { wrapperSuspect: false })).not.toThrow()
  })

  test("network-enabled and full-access states skip all checks", () => {
    expect(() => Isolation.assertBashNetwork(networkOnState, ["curl"], { wrapperSuspect: true })).not.toThrow()
    expect(() => Isolation.assertBashNetwork(fullAccessState, ["curl"], { wrapperSuspect: true })).not.toThrow()
    expect(() => Isolation.assertBashNetwork(undefined, ["curl"])).not.toThrow()
  })
})
