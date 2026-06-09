import path from "path"
import type { AppContextTemplateData, AppContextTemplateKey } from "./app-context-schema"

function relativeFromRoot(root: string, cwd: string) {
  return path.relative(root, cwd)
}

export function contextTemplates(input: { root: string; dir: string }) {
  const list: AppContextTemplateData[] = [
    {
      key: "repo-rules" as const,
      title: "Repo rules",
      description: "Default instructions for this repository.",
      path: path.join(input.root, "AGENTS.md"),
      kind: "instruction" as const,
    },
    {
      key: "review-checklist" as const,
      title: "Review checklist",
      description: "A reusable checklist for code review and verification.",
      path: path.join(input.root, "docs", "review-checklist.md"),
      kind: "checklist" as const,
    },
    {
      key: "frontend-style-guide" as const,
      title: "Frontend style guide",
      description: "UI and UX guidance for interface changes.",
      path: path.join(input.root, "docs", "frontend-style-guide.md"),
      kind: "checklist" as const,
    },
    {
      key: "release-checklist" as const,
      title: "Release checklist",
      description: "Pre-release verification steps and rollout notes.",
      path: path.join(input.root, "docs", "release-checklist.md"),
      kind: "checklist" as const,
    },
  ]

  if (path.resolve(input.dir) !== path.resolve(input.root)) {
    list.splice(1, 0, {
      key: "dir-rules" as const,
      title: "Directory rules",
      description: "Instructions scoped to the current working directory.",
      path: path.join(input.dir, "AGENTS.md"),
      kind: "instruction" as const,
    })
  }

  return list
}

export function templateBody(input: { key: AppContextTemplateKey; root: string; dir: string }) {
  switch (input.key) {
    case "repo-rules":
      return [
        "# Project Instructions",
        "",
        "## Workflow",
        "- Inspect the existing code before changing it.",
        "- Keep changes scoped to the request.",
        "- Run the relevant checks before finishing.",
        "",
        "## Review",
        "- Prioritize bugs, regressions, and missing tests.",
        "- Call out risky assumptions and follow-up work.",
        "",
        "## Style",
        "- Match the existing patterns in this repository.",
        "- Prefer clear labels, safe defaults, and concise explanations.",
      ].join("\n")
    case "dir-rules":
      return [
        "# Directory Instructions",
        "",
        `Scope: \`${relativeFromRoot(input.root, input.dir) || "."}\``,
        "",
        "## Focus",
        "- Keep changes in this directory aligned with the local patterns.",
        "- Reuse nearby components, helpers, and naming conventions first.",
        "",
        "## Checks",
        "- Run the narrowest relevant checks for this area before finishing.",
        "- Note any file-specific risks or follow-up items in the summary.",
      ].join("\n")
    case "review-checklist":
      return [
        "# Review Checklist",
        "",
        "- [ ] Confirm the changed files match the request.",
        "- [ ] Check loading, empty, and error states.",
        "- [ ] Verify renamed or deleted imports, routes, and references.",
        "- [ ] Run the relevant tests, lint, and build checks.",
        "- [ ] Note follow-up risks, assumptions, or rollout concerns.",
      ].join("\n")
    case "frontend-style-guide":
      return [
        "# Frontend Style Guide",
        "",
        "- Reuse shared components, tokens, and layout patterns before adding new ones.",
        "- Keep primary actions obvious and labels specific.",
        "- Cover empty, loading, and error states for new UI.",
        "- Verify responsive layout, keyboard flow, and text truncation.",
        "- Prefer low-risk presentation changes over new runtime behavior unless necessary.",
      ].join("\n")
    case "release-checklist":
      return [
        "# Release Checklist",
        "",
        "- [ ] Review user-facing changes and migration notes.",
        "- [ ] Run tests, lint, and build checks for the affected packages.",
        "- [ ] Confirm config, dependency, or env changes are documented.",
        "- [ ] Verify monitoring, rollback, or support notes if risk is non-trivial.",
        "- [ ] Capture any follow-up work that should not block release.",
      ].join("\n")
  }
}
