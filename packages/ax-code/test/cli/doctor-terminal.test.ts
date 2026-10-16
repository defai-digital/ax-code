import { describe, expect, test } from "vitest"
import { runTerminalDoctorChecks, readTmuxOption } from "../../src/cli/cmd/doctor-terminal"
import { executeTerminalDoctor } from "../../src/cli/cmd/doctor"

function tmuxOptions(values: Record<string, string | undefined>) {
  return async (name: string) => values[name]
}

function byId(checks: Awaited<ReturnType<typeof runTerminalDoctorChecks>>) {
  return new Map(checks.map((check) => [check.id, check]))
}

describe("doctor terminal checks (ADR-223)", () => {
  test("plain terminal: no multiplexer, tmux options not applicable, direct OSC 52", async () => {
    const checks = await runTerminalDoctorChecks({
      env: { TERM: "xterm-256color", TERM_PROGRAM: "ghostty", COLORTERM: "truecolor" },
      tmuxOption: tmuxOptions({}),
    })
    const by = byId(checks)

    expect(by.get("terminal")).toMatchObject({
      status: "ok",
      detail: "TERM xterm-256color; TERM_PROGRAM ghostty",
    })
    expect(by.get("multiplexer")).toMatchObject({
      status: "ok",
      detail: expect.stringContaining("none detected"),
    })
    // Absent tmux: the option checks are not emitted at all.
    expect(by.has("tmux-set-clipboard")).toBe(false)
    expect(by.has("tmux-allow-passthrough")).toBe(false)
    expect(by.has("tmux-extended-keys")).toBe(false)
    expect(by.get("osc52-clipboard")?.detail).toContain("direct OSC 52")
    expect(by.get("dcs-passthrough")).toMatchObject({ status: "ok" })
    expect(by.get("truecolor")?.detail).toContain("COLORTERM=truecolor")
  })

  test("healthy tmux: options reported, passthrough ready, no warnings", async () => {
    const checks = await runTerminalDoctorChecks({
      env: { TERM: "screen-256color", TERM_PROGRAM: "tmux", TMUX: "/tmp/tmux-0/default,123,0" },
      tmuxOption: tmuxOptions({ "set-clipboard": "external", "allow-passthrough": "on", "extended-keys": "on" }),
    })
    const by = byId(checks)

    expect(by.get("multiplexer")?.detail).toContain("tmux session detected")
    // The TMUX socket path must never be echoed.
    expect(JSON.stringify(checks)).not.toContain("/tmp/tmux-0")
    expect(by.get("tmux-set-clipboard")).toMatchObject({ status: "ok", detail: "external" })
    expect(by.get("tmux-allow-passthrough")).toMatchObject({ status: "ok", detail: "on" })
    expect(by.get("tmux-extended-keys")).toMatchObject({ status: "ok", detail: "on" })
    expect(by.get("osc52-clipboard")).toMatchObject({ status: "ok" })
    expect(by.get("dcs-passthrough")).toMatchObject({ status: "ok" })
    expect(checks.every((check) => check.status === "ok")).toBe(true)
  })

  test("tmux with passthrough off warns on DCS but keeps clipboard when set-clipboard works", async () => {
    const checks = await runTerminalDoctorChecks({
      env: { TERM: "tmux-256color", TMUX: "socket" },
      tmuxOption: tmuxOptions({ "set-clipboard": "external", "allow-passthrough": "off" }),
    })
    const by = byId(checks)

    expect(by.get("osc52-clipboard")).toMatchObject({ status: "ok" })
    expect(by.get("dcs-passthrough")).toMatchObject({ status: "warn" })
    expect(by.get("dcs-passthrough")?.detail).toContain("allow-passthrough is off")
  })

  test("tmux with set-clipboard off warns on the OSC 52 row", async () => {
    const checks = await runTerminalDoctorChecks({
      env: { TERM: "tmux-256color", TMUX: "socket" },
      tmuxOption: tmuxOptions({ "set-clipboard": "off", "allow-passthrough": "on" }),
    })
    const by = byId(checks)

    expect(by.get("osc52-clipboard")).toMatchObject({ status: "warn" })
    expect(by.get("osc52-clipboard")?.detail).toContain("set-clipboard is off")
    expect(by.get("dcs-passthrough")).toMatchObject({ status: "ok" })
  })

  test("unset allow-passthrough warns because tmux 3.3+ defaults it off", async () => {
    const checks = await runTerminalDoctorChecks({
      env: { TMUX: "socket" },
      tmuxOption: tmuxOptions({ "set-clipboard": "on" }),
    })
    const by = byId(checks)

    expect(by.get("tmux-allow-passthrough")?.detail).toBe("(unset)")
    expect(by.get("dcs-passthrough")).toMatchObject({ status: "warn" })
    expect(by.get("dcs-passthrough")?.detail).toContain("not set")
  })

  test("GNU Screen: wrapped OSC 52 and DCS chunking reported without warnings", async () => {
    const checks = await runTerminalDoctorChecks({
      env: { TERM: "screen", STY: "12345.session" },
      tmuxOption: tmuxOptions({}),
    })
    const by = byId(checks)

    expect(by.get("multiplexer")?.detail).toContain("GNU Screen")
    expect(by.get("osc52-clipboard")?.detail).toContain("252-byte DCS chunks")
    expect(by.get("dcs-passthrough")).toMatchObject({ status: "ok" })
    expect(by.has("tmux-set-clipboard")).toBe(false)
  })

  test("Zellij: detected, named, and not treated as tmux", async () => {
    const checks = await runTerminalDoctorChecks({
      env: { TERM: "alacritty", ZELLIJ: "0" },
      tmuxOption: tmuxOptions({}),
    })
    const by = byId(checks)

    expect(by.get("multiplexer")?.detail).toContain("Zellij")
    expect(by.get("osc52-clipboard")?.detail).toContain("Zellij")
    expect(by.has("tmux-extended-keys")).toBe(false)
  })

  test("unset TERM, TERM_PROGRAM, and COLORTERM are reported as such, never warned", async () => {
    const checks = await runTerminalDoctorChecks({ env: {}, tmuxOption: tmuxOptions({}) })
    const by = byId(checks)

    expect(by.get("terminal")?.detail).toBe("TERM (unset); TERM_PROGRAM (unset)")
    expect(by.get("truecolor")?.detail).toContain("COLORTERM unset")
    expect(checks.every((check) => check.status === "ok")).toBe(true)
  })
})

describe("doctor terminal output (ADR-223)", () => {
  test("human table names every check", async () => {
    const out: string[] = []
    const code = await executeTerminalDoctor(
      { json: false },
      {
        env: { TERM: "xterm-256color" },
        tmuxOption: tmuxOptions({}),
        stdout: (text) => out.push(text),
        exit: () => {},
      },
    )
    expect(code).toBe(0)
    const text = out.join("")
    expect(text).toContain("Terminal: TERM xterm-256color")
    expect(text).toContain("Multiplexer:")
    expect(text).toContain("OSC 52 clipboard:")
    expect(text).toContain("DCS passthrough:")
  })

  test("JSON report carries ids and statuses and exits 0 even with warnings", async () => {
    const out: string[] = []
    const code = await executeTerminalDoctor(
      { json: true },
      {
        env: { TMUX: "socket", TERM: "tmux-256color" },
        tmuxOption: tmuxOptions({ "set-clipboard": "external", "allow-passthrough": "off" }),
        stdout: (text) => out.push(text),
        exit: () => {},
      },
    )
    expect(code).toBe(0)
    const report = JSON.parse(out.join(""))
    expect(report.ok).toBe(true)
    const ids = report.checks.map((check: { id: string }) => check.id)
    expect(ids).toContain("tmux-set-clipboard")
    expect(ids).toContain("tmux-allow-passthrough")
    expect(ids).toContain("tmux-extended-keys")
    const dcs = report.checks.find((check: { id: string }) => check.id === "dcs-passthrough")
    expect(dcs.status).toBe("warn")
    expect(JSON.stringify(report)).not.toContain("socket")
  })
})

describe("readTmuxOption", () => {
  test("returns undefined when tmux is not installed", async () => {
    // Safe on every host: `tmux show-options` for a never-defined user
    // option exits non-zero, so an installed tmux also yields undefined.
    const value = await readTmuxOption("ax-code-doctor-probe-nonexistent-option")
    expect(value).toBeUndefined()
  })
})
