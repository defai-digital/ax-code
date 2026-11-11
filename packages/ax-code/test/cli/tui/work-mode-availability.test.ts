import { describe, expect, test } from "vitest"
import {
  countingProviders,
  ensembleModelProviderID,
  ensembleSlashCommand,
  isWorkModeHintSeen,
  nextAvailableWorkMode,
  typedEnsembleCommandBlock,
  workModeAvailability,
  workModeChipView,
  workModeChipVisible,
  workModeCycleToast,
  workModeHint,
  workModePickerOptions,
  withWorkModeHintSeen,
  type AvailabilityProvider,
} from "../../../src/cli/tui/component/work-mode-availability"

const selectable = { tool_call: true }
const notSelectable = { tool_call: false }

function provider(id: string, models: Record<string, object> = { m: selectable }): AvailabilityProvider {
  return { id, models }
}

const twoProviders = [provider("p1"), provider("p2")]

describe("countingProviders", () => {
  test("counts only providers with at least one selectable chat model", () => {
    expect(countingProviders([])).toBe(0)
    expect(countingProviders([provider("p1", {})])).toBe(0)
    expect(countingProviders([provider("p1", { m: notSelectable })])).toBe(0)
    expect(countingProviders([provider("p1", { embed: selectable })])).toBe(0)
    expect(countingProviders([provider("p1", { embed: selectable, chat: selectable })])).toBe(1)
    expect(countingProviders(twoProviders)).toBe(2)
  })

  test("a provider with several models still counts once (auto-selection picks one per provider)", () => {
    expect(countingProviders([provider("p1", { m1: selectable, m2: selectable })])).toBe(1)
  })
})

describe("workModeAvailability", () => {
  test("agent is always available", () => {
    expect(
      workModeAvailability({ mode: "agent", providers: [], providerLoaded: false, modelProviderID: undefined }),
    ).toEqual({
      state: "available",
      members: 1,
    })
  })

  test("council and arena report checking until providers finish loading", () => {
    for (const mode of ["council", "arena"] as const) {
      const state = workModeAvailability({
        mode,
        providers: twoProviders,
        providerLoaded: false,
        modelProviderID: undefined,
      })
      expect(state.state).toBe("checking")
      expect(state.members).toBe(0)
    }
  })

  test("council needs two counting providers and reports the connected count", () => {
    const state = workModeAvailability({
      mode: "council",
      providers: [provider("p1")],
      providerLoaded: true,
      modelProviderID: undefined,
    })
    expect(state).toMatchObject({ state: "unavailable", reason: "needs 2" })
    expect(state.detail).toContain("1 connected")
  })

  test("council is available by default with two providers, capped by config", () => {
    expect(
      workModeAvailability({
        mode: "council",
        providers: twoProviders,
        providerLoaded: true,
        modelProviderID: undefined,
      }),
    ).toMatchObject({
      state: "available",
      members: 2,
    })
    expect(
      workModeAvailability({
        mode: "council",
        providers: [provider("p1"), provider("p2"), provider("p3"), provider("p4")],
        providerLoaded: true,
        modelProviderID: undefined,
        config: { council: { maxMembers: 6 } },
      }),
    ).toMatchObject({ state: "available", members: 4 })
  })

  test("council reports disabled and a one-member cap", () => {
    expect(
      workModeAvailability({
        mode: "council",
        providers: twoProviders,
        providerLoaded: true,
        modelProviderID: undefined,
        config: { council: { enabled: false } },
      }),
    ).toMatchObject({ state: "unavailable", reason: "off" })
    expect(
      workModeAvailability({
        mode: "council",
        providers: twoProviders,
        providerLoaded: true,
        modelProviderID: undefined,
        config: { council: { maxMembers: 1 } },
      }),
    ).toMatchObject({ state: "unavailable", reason: "max 1" })
  })

  test("arena is off unless explicitly enabled", () => {
    expect(
      workModeAvailability({
        mode: "arena",
        providers: twoProviders,
        providerLoaded: true,
        modelProviderID: undefined,
      }),
    ).toMatchObject({
      state: "unavailable",
      reason: "off",
    })
    expect(
      workModeAvailability({
        mode: "arena",
        providers: twoProviders,
        providerLoaded: true,
        modelProviderID: undefined,
        config: { arena: { enabled: true, maxContestants: 1 } },
      }),
    ).toMatchObject({ state: "unavailable", reason: "max 1" })
  })

  test("arena is available when enabled with two providers", () => {
    expect(
      workModeAvailability({
        mode: "arena",
        providers: twoProviders,
        providerLoaded: true,
        modelProviderID: undefined,
        config: { arena: { enabled: true } },
      }),
    ).toMatchObject({ state: "available", members: 2 })
  })

  test("council and arena are unavailable when the selected model is a CLI provider", () => {
    for (const mode of ["council", "arena"] as const) {
      const state = workModeAvailability({
        mode,
        providers: twoProviders,
        providerLoaded: true,
        config: { arena: { enabled: true } },
        modelProviderID: "claude-code",
      })
      expect(state).toMatchObject({ state: "unavailable", reason: "CLI model" })
      expect(state.detail).toContain("non-CLI (API) model")
      expect(state.detail).toContain("CLI providers cannot call AX Code tools")
    }
  })

  test("an API-provider model keeps council and arena available", () => {
    expect(
      workModeAvailability({
        mode: "council",
        providers: twoProviders,
        providerLoaded: true,
        modelProviderID: "anthropic",
      }),
    ).toMatchObject({ state: "available", members: 2 })
  })

  test("a custom *-cli provider is treated as a CLI provider", () => {
    for (const mode of ["council", "arena"] as const) {
      const state = workModeAvailability({
        mode,
        providers: twoProviders,
        providerLoaded: true,
        config: { arena: { enabled: true } },
        modelProviderID: "acme-cli",
      })
      expect(state).toMatchObject({ state: "unavailable", reason: "CLI model" })
    }
  })

  test("a retired CLI provider is not treated as a CLI provider", () => {
    expect(
      workModeAvailability({
        mode: "council",
        providers: twoProviders,
        providerLoaded: true,
        modelProviderID: "minimax-cli",
      }),
    ).toMatchObject({ state: "available", members: 2 })
  })
})

describe("ensembleModelProviderID", () => {
  test("prefers the build agent's config-pinned model over the current model", () => {
    expect(
      ensembleModelProviderID({
        agents: [{ name: "build", model: { providerID: "anthropic" } }],
        current: { providerID: "claude-code" },
      }),
    ).toBe("anthropic")
  })

  test("falls back to the current model when build has no pinned model", () => {
    expect(
      ensembleModelProviderID({
        agents: [{ name: "build" }],
        current: { providerID: "openai" },
      }),
    ).toBe("openai")
  })

  test("returns undefined when there is no build agent and no current model", () => {
    expect(ensembleModelProviderID({ agents: [{ name: "architect" }], current: undefined })).toBeUndefined()
  })
})

describe("ensembleSlashCommand + typedEnsembleCommandBlock", () => {
  const builtinCommands = [
    { name: "council", scope: "builtin" },
    { name: "arena", scope: "builtin" },
  ]

  test("recognizes only `/council` and `/arena` as the first token", () => {
    expect(ensembleSlashCommand("/council review auth", builtinCommands)).toBe("council")
    expect(ensembleSlashCommand("  /arena plan", builtinCommands)).toBe("arena")
    expect(ensembleSlashCommand("/debug auth", builtinCommands)).toBeUndefined()
    expect(ensembleSlashCommand("council review", builtinCommands)).toBeUndefined()
  })

  test("ignores a same-named custom command", () => {
    expect(ensembleSlashCommand("/council", [{ name: "council", scope: "user" }])).toBeUndefined()
    expect(ensembleSlashCommand("/council", [])).toBeUndefined()
  })

  test("blocks a typed command only for the CLI reason, in every work mode", () => {
    const availability = (reason: "CLI model" | "off" | "needs 2" | "max 1") => () => ({
      state: "unavailable" as const,
      members: 0,
      reason,
    })
    // Work-mode independence is exercised end-to-end in the submit controller
    // test: routeInput keeps slash text a prompt, so armed modes land here too.
    expect(
      typedEnsembleCommandBlock({
        text: "/council review",
        commands: builtinCommands,
        availability: availability("CLI model"),
      })?.mode,
    ).toBe("council")
    expect(
      typedEnsembleCommandBlock({
        text: "/arena plan",
        commands: builtinCommands,
        availability: availability("CLI model"),
      })?.mode,
    ).toBe("arena")
    expect(
      typedEnsembleCommandBlock({
        text: "/council review",
        commands: builtinCommands,
        availability: availability("off"),
      }),
    ).toBeUndefined()
  })
})

describe("workModeChipVisible", () => {
  test("hides the default Agent chip and shows armed ensemble modes", () => {
    expect(workModeChipVisible("agent")).toBe(false)
    expect(workModeChipVisible("council")).toBe(true)
    expect(workModeChipVisible("arena")).toBe(true)
  })
})

describe("workModePickerOptions", () => {
  test("agent is always selectable; arena is disabled until enabled", () => {
    const options = workModePickerOptions({
      providers: twoProviders,
      providerLoaded: true,
      modelProviderID: undefined,
    })
    expect(options.map((option) => option.value)).toEqual(["agent", "council", "arena"])
    expect(options[0]).toMatchObject({ value: "agent", disabled: false })
    expect(options[1]).toMatchObject({ value: "council", disabled: false })
    expect(options[1].description).toContain("reviewers")
    expect(options[1].description).toContain("advisory")
    expect(options[2]).toMatchObject({ value: "arena", disabled: true })
    expect(options[2].description).toContain("off")
  })

  test("enables arena when configured and names contestants", () => {
    const options = workModePickerOptions({
      providers: twoProviders,
      providerLoaded: true,
      modelProviderID: undefined,
      config: { arena: { enabled: true } },
    })
    expect(options[2]).toMatchObject({ value: "arena", disabled: false })
    expect(options[2].description).toContain("contestants")
  })

  test("disables council when fewer than two providers are connected", () => {
    const options = workModePickerOptions({
      providers: [provider("p1")],
      providerLoaded: true,
      modelProviderID: undefined,
    })
    expect(options[1]).toMatchObject({ value: "council", disabled: true })
    expect(options[1].description).toContain("1 connected")
  })

  test("disables council and arena rows for a CLI-provider model", () => {
    const options = workModePickerOptions({
      providers: twoProviders,
      providerLoaded: true,
      config: { arena: { enabled: true } },
      modelProviderID: "codex-cli",
    })
    expect(options[0]).toMatchObject({ value: "agent", disabled: false })
    expect(options[1]).toMatchObject({ value: "council", disabled: true })
    expect(options[1].description).toContain("non-CLI (API) model")
    expect(options[2]).toMatchObject({ value: "arena", disabled: true })
    expect(options[2].description).toContain("non-CLI (API) model")
  })
})

describe("workModeChipView", () => {
  test("available council shows the effective member count, filled", () => {
    expect(
      workModeChipView("council", {
        state: "available",
        members: 2,
      }),
    ).toEqual({ label: "Council · 2", active: true })
  })

  test("unavailable modes render hollow with the reason", () => {
    expect(workModeChipView("arena", { state: "unavailable", members: 0, reason: "off" })).toEqual({
      label: "Arena (off)",
      active: false,
    })
    expect(workModeChipView("council", { state: "unavailable", members: 0, reason: "needs 2" })).toEqual({
      label: "Council (needs 2)",
      active: false,
    })
  })

  test("checking renders hollow without a reason", () => {
    expect(workModeChipView("council", { state: "checking", members: 0 })).toEqual({
      label: "Council (…)",
      active: false,
    })
    expect(workModeChipView("agent", { state: "available", members: 1 })).toEqual({ label: "Agent", active: true })
  })
})

describe("workModeHint", () => {
  test("no hint in agent mode", () => {
    expect(workModeHint("agent", { state: "available", members: 1 })).toBeUndefined()
  })

  test("available modes explain cost and semantics with the config cap", () => {
    expect(workModeHint("council", { state: "available", members: 4 })).toContain("up to 4 reviewers")
    expect(workModeHint("arena", { state: "available", members: 2 })).toContain("up to 2 contestants")
    expect(workModeHint("council", { state: "available", members: 4 })).toContain("advisory")
  })

  test("unavailable modes say the submit is blocked", () => {
    expect(
      workModeHint("arena", { state: "unavailable", members: 0, reason: "off", detail: "Arena is off" }),
    ).toContain("submit is blocked")
  })

  test("available modes hide the hint after the mode has been explained", () => {
    expect(workModeHint("council", { state: "available", members: 4 }, { explained: true })).toBeUndefined()
    expect(workModeHint("arena", { state: "available", members: 2 }, { explained: true })).toBeUndefined()
    expect(
      workModeHint(
        "council",
        { state: "unavailable", members: 0, reason: "off", detail: "Council is off" },
        { explained: true },
      ),
    ).toContain("submit is blocked")
  })
})

describe("work-mode hint seen store", () => {
  test("records and reads per-mode first-use flags", () => {
    expect(isWorkModeHintSeen(undefined, "council")).toBe(false)
    const seen = withWorkModeHintSeen(undefined, "council")
    expect(isWorkModeHintSeen(seen, "council")).toBe(true)
    expect(isWorkModeHintSeen(seen, "arena")).toBe(false)
    expect(isWorkModeHintSeen(withWorkModeHintSeen(seen, "arena"), "arena")).toBe(true)
  })
})

describe("nextAvailableWorkMode + workModeCycleToast", () => {
  const availability = (states: Record<string, "available" | "unavailable">) => (mode: string) =>
    mode === "agent" || states[mode] === "available"
      ? { state: "available" as const, members: mode === "agent" ? 1 : 2 }
      : { state: "unavailable" as const, members: 0, detail: `${mode} unavailable` }

  test("lands on the next available mode and reports skipped modes", () => {
    const { next, skipped } = nextAvailableWorkMode(
      "agent",
      availability({ agent: "available", council: "available", arena: "unavailable" }) as never,
    )
    expect(next).toBe("council")
    expect(skipped).toEqual([])

    const second = nextAvailableWorkMode(
      "council",
      availability({ agent: "available", council: "available", arena: "unavailable" }) as never,
    )
    expect(second.next).toBe("agent")
    expect(second.skipped.map((item) => item.mode)).toEqual(["arena"])
    expect(workModeCycleToast("agent", { state: "available", members: 1 }, second.skipped)).toContain(
      "skipped Arena (arena unavailable)",
    )
  })

  test("stays on the current mode when nothing else is available", () => {
    const { next, skipped } = nextAvailableWorkMode(
      "agent",
      availability({ council: "unavailable", arena: "unavailable" }) as never,
    )
    expect(next).toBe("agent")
    expect(skipped.map((item) => item.mode)).toEqual(["council", "arena"])
  })
})
