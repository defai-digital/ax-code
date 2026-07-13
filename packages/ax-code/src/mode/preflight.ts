/**
 * Ensemble tool preflight messages (ADR-049 UX).
 * Pure string builders — no IO.
 */

export namespace EnsemblePreflight {
  export type ProviderSnapshot = {
    count: number
    ids: string[]
  }

  export function formatProviderLine(providers: ProviderSnapshot): string {
    if (providers.count === 0) return "Connected coding providers: **0** (none selectable)."
    const shown = providers.ids.slice(0, 8).join(", ")
    const more = providers.ids.length > 8 ? `, +${providers.ids.length - 8} more` : ""
    return `Connected coding providers: **${providers.count}** (${shown}${more}).`
  }

  export function arenaDisabledMessage(input: {
    providers: ProviderSnapshot
    projectConfigHint?: string
  }): string {
    const lines = [
      "# Arena disabled",
      "",
      "Arena is **opt-in**. Set this in project `ax-code.json` (often gitignored):",
      "",
      "```json",
      "{",
      '  "modes": {',
      '    "arena": {',
      '      "enabled": true,',
      '      "maxContestants": 2,',
      '      "strategy": "verify_first"',
      "    }",
      "  }",
      "}",
      "```",
      "",
      "Or re-call the **arena** tool with `enableIfDisabled: true` to write that flag and continue in this session.",
      "",
      input.providers ? formatProviderLine(input.providers) : "",
      input.providers.count < 2
        ? "Arena needs **≥2** connected providers with selectable models. Use `/connect` or `ax-code providers login`."
        : "Provider count looks sufficient for a multi-model run once enabled.",
      "",
      "**Task fit:**",
      "- Code quality *findings* / security review → prefer **council** (`kind: review`)",
      "- Compare *approaches* only → arena `mode: plan`",
      "- Compete on real *patches* → arena `mode: implement` (git worktrees; no auto-merge)",
      "",
      input.projectConfigHint ? `Config path hint: \`${input.projectConfigHint}\`` : "",
      "",
      "After enabling via file edit, **re-call arena** (config is re-read each call). A full session restart is not required.",
    ]
    return lines.filter((l) => l !== undefined).join("\n")
  }

  export function arenaInsufficientProvidersMessage(providers: ProviderSnapshot): string {
    return [
      "# Arena: need ≥2 providers",
      "",
      formatProviderLine(providers),
      "",
      "Connect at least two coding providers (different families preferred), then re-run.",
      "Examples: hosted API + CLI provider, or two API providers via `/connect`.",
      "",
      "Pass `providers: [{ providerID, modelID? }, ...]` to pick specific contestants once connected.",
    ].join("\n")
  }

  export function councilDisabledMessage(): string {
    return [
      "# Council disabled",
      "",
      "Council is disabled in config (`modes.council.enabled: false`).",
      "Re-enable with `modes.council.enabled: true` in `ax-code.json`, then re-call **council**.",
      "Config is re-read each tool call — no session restart required after the edit.",
    ].join("\n")
  }

  export function councilInsufficientProvidersMessage(providers: ProviderSnapshot): string {
    return [
      "# Council: no / insufficient members",
      "",
      formatProviderLine(providers),
      "",
      "Council needs connected providers with selectable models.",
      "For consensus tiers, aim for **≥2** successful members.",
      "Connect providers via `/connect` or `ax-code providers login`, then re-run.",
    ].join("\n")
  }

  /** Suggest tool for a free-text task (slash / agent guidance). */
  export function suggestTool(task: string): "council" | "arena_plan" | "arena_implement" | "hybrid" {
    const t = task.toLowerCase()
    if (/\b(implement|fix|patch|refactor|write code|apply)\b/.test(t) && /\b(arena|best.?of|multi.?model)\b/.test(t)) {
      return "arena_implement"
    }
    if (/\b(implement|fix|patch|write the|build the)\b/.test(t) && /\b(compet|race|best.?of|arena)\b/.test(t)) {
      return "arena_implement"
    }
    if (/\b(quality|review|security|vulnerab|rate|good|worse|findings?|audit)\b/.test(t)) {
      return "council"
    }
    if (/\b(approach|plan|compare|strategy|options?)\b/.test(t)) {
      return "arena_plan"
    }
    if (/\b(local|cloud|hybrid|offline|privacy)\b/.test(t)) {
      return "hybrid"
    }
    return "arena_plan"
  }

  /**
   * True when the user asked for multi-provider ensemble and agents should
   * not open task_parallel monorepo digs first.
   */
  export function forbidsTaskParallelFirst(text: string): boolean {
    const t = text.toLowerCase()
    return (
      /\bcouncil\b/.test(t) ||
      /\barena\b/.test(t) ||
      /\bbest-?of-?n\b/.test(t) ||
      /\bmulti-?provider\b/.test(t) ||
      /\bmulti-?model\b/.test(t)
    )
  }
}
