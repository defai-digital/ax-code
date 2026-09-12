import { describe, expect, test } from "vitest"
import {
  countingProviders,
  isWorkModeHintSeen,
  nextAvailableWorkMode,
  workModeAvailability,
  workModeChipView,
  workModeCycleToast,
  workModeHint,
  withWorkModeHintSeen,
  type AvailabilityProvider,
} from "../../../src/cli/cmd/tui/component/work-mode-availability"

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
    expect(workModeAvailability({ mode: "agent", providers: [], providerLoaded: false })).toEqual({
      state: "available",
      members: 1,
    })
  })

  test("council and arena report checking until providers finish loading", () => {
    for (const mode of ["council", "arena"] as const) {
      const state = workModeAvailability({ mode, providers: twoProviders, providerLoaded: false })
      expect(state.state).toBe("checking")
      expect(state.members).toBe(0)
    }
  })

  test("council needs two counting providers and reports the connected count", () => {
    const state = workModeAvailability({ mode: "council", providers: [provider("p1")], providerLoaded: true })
    expect(state).toMatchObject({ state: "unavailable", reason: "needs 2" })
    expect(state.detail).toContain("1 connected")
  })

  test("council is available by default with two providers, capped by config", () => {
    expect(workModeAvailability({ mode: "council", providers: twoProviders, providerLoaded: true })).toMatchObject({
      state: "available",
      members: 2,
    })
    expect(
      workModeAvailability({
        mode: "council",
        providers: [provider("p1"), provider("p2"), provider("p3"), provider("p4")],
        providerLoaded: true,
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
        config: { council: { enabled: false } },
      }),
    ).toMatchObject({ state: "unavailable", reason: "off" })
    expect(
      workModeAvailability({
        mode: "council",
        providers: twoProviders,
        providerLoaded: true,
        config: { council: { maxMembers: 1 } },
      }),
    ).toMatchObject({ state: "unavailable", reason: "max 1" })
  })

  test("arena is off unless explicitly enabled", () => {
    expect(workModeAvailability({ mode: "arena", providers: twoProviders, providerLoaded: true })).toMatchObject({
      state: "unavailable",
      reason: "off",
    })
    expect(
      workModeAvailability({
        mode: "arena",
        providers: twoProviders,
        providerLoaded: true,
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
        config: { arena: { enabled: true } },
      }),
    ).toMatchObject({ state: "available", members: 2 })
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
