/**
 * Agentic runtime harness eval — CI-callable suite for gates shipped under ADR-048.
 *
 * Run:
 *   pnpm exec vitest run test/harness/agentic-runtime-eval.test.ts
 */
import { describe, expect, test } from "vitest"
import { GoalVerification } from "../../src/session/goal-verification"
import { WriteIsolation } from "../../src/session/write-isolation"
import { VerificationPolicy } from "../../src/session/verification-policy"
import { OsSandbox } from "../../src/isolation/os-sandbox"
import { Isolation } from "../../src/isolation"
import { LifecycleHooks } from "../../src/hooks/lifecycle"
import { IntelligenceNudge } from "../../src/session/intelligence-nudge"
import os from "os"

describe("agentic-runtime-eval", () => {
  test("goal gate rejects unverified mutations and accepts verify_project", () => {
    const unverified = GoalVerification.decide({
      messages: [
        {
          info: { role: "assistant" },
          parts: [{ type: "tool", tool: "edit", state: { status: "completed" } }],
        },
      ],
      pendingTodos: [],
    })
    expect(unverified.ok).toBe(false)

    const verified = GoalVerification.decide({
      messages: [
        {
          info: { role: "assistant" },
          parts: [
            { type: "tool", tool: "edit", state: { status: "completed" } },
            {
              type: "tool",
              tool: "verify_project",
              state: { status: "completed", metadata: { passed: true } },
            },
          ],
        },
      ],
      pendingTodos: [],
    })
    expect(verified.ok).toBe(true)
  })

  test("write isolation rejects multi-writer parallel digs", () => {
    const decision = WriteIsolation.evaluateParallelAgents([
      { name: "build", permission: [{ permission: "*", pattern: "*", action: "allow" }] },
      { name: "debug", permission: [{ permission: "*", pattern: "*", action: "allow" }] },
    ])
    expect(decision.ok).toBe(false)
  })

  test("verification policy prefers real project checks", () => {
    const cmds = VerificationPolicy.preferredCommands({
      hasPackageJson: true,
      packageManager: "pnpm",
      scripts: { test: true, typecheck: true },
    })
    expect(cmds.preferred[0]).toContain("test")
    expect(VerificationPolicy.looksLikeVerificationCommand("pnpm test")).toBe(true)
    expect(VerificationPolicy.isTrivialVerificationCommand("git status")).toBe(true)
  })

  test("OS sandbox profile generation is deterministic and network-aware", () => {
    const profile = OsSandbox.buildSeatbeltProfile({
      workspaceRoot: "/proj",
      network: false,
      protectedPaths: ["/proj/.git"],
    })
    expect(profile).toContain("(deny network*)")
    expect(
      Isolation.shouldUseOsSandbox(Isolation.resolve({ backend: "os", mode: "workspace-write" }, os.tmpdir())),
    ).toBe(true)
  })

  test("lifecycle packs include PreToolUse/PostToolUse/Stop and block force-push", async () => {
    const packs = LifecycleHooks.listBuiltinPacks()
    expect(packs.length).toBeGreaterThanOrEqual(5)
    const force = packs.find((p) => p.name === "block-force-push")!
    const result = await LifecycleHooks.runHooks(force.hooks, {
      event: "PreToolUse",
      tool: "bash",
      args: { command: "git push -f origin HEAD" },
    })
    expect(result.blocked).toBe(true)
  })

  test("intelligence nudge fires for multi-file edits", () => {
    const decision = IntelligenceNudge.evaluate([
      {
        info: { role: "assistant" },
        parts: [
          { type: "tool", tool: "edit", state: { status: "completed", input: { filePath: "a.ts" } } },
          { type: "tool", tool: "edit", state: { status: "completed", input: { filePath: "b.ts" } } },
        ],
      },
    ])
    expect(decision.active).toBe(true)
  })
})
