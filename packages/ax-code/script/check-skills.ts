import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { z } from "zod"
import { ConfigMarkdown } from "../src/config/markdown"
import { SkillValidate } from "../src/skill/validate"

// Build-time lint for skills. The runtime (`addBuiltinSkill`) only reads
// `name`/`description` and skips `validateStandardSkill`, so a malformed
// built-in skill would load silently or be dropped without warning. This check
// enforces the standard-skill contract on every skill shipped in `skills/`.
//
// With `--all` it walks every scope the loader scans (builtin, user/project
// `.claude|.agents|.opencode`, and `.ax-code` config dirs). Built-in issues
// fail the build; other scopes are user-authored, so they are reported as
// warnings — the runtime never hard-fails on them, it records `standardIssues`.

export namespace SkillLint {
  export interface Issue {
    skill: string
    location: string
    problems: string[]
  }

  export interface ScopeSpec {
    scope: string
    dir: string
    pattern: string
    gate: "fail" | "warn"
  }

  export interface ScopeResult extends ScopeSpec {
    count: number
    issues: Issue[]
  }

  const metadataSchema = z.record(z.string(), z.string())

  async function validateFile(location: string): Promise<string[]> {
    const md = await ConfigMarkdown.parse(location).catch(() => undefined)
    if (!md) return ["frontmatter failed to parse"]

    const data = md.data as Record<string, unknown>
    const skillName = typeof data.name === "string" ? data.name : undefined
    const description = typeof data.description === "string" ? data.description : undefined
    const compatibility = typeof data.compatibility === "string" ? data.compatibility : undefined
    const hasInvalidMetadata = data.metadata !== undefined && !metadataSchema.safeParse(data.metadata).success

    const problems: string[] = []
    if (skillName === undefined) problems.push("frontmatter missing `name`")
    if (description === undefined) problems.push("frontmatter missing `description`")

    // The loader only keeps `argument-hint` when it is a string. A value like
    // `[file or dir]` is parsed by YAML as a flow sequence (array) and silently
    // dropped, so the hint never reaches users. Require it to be quoted.
    if (data["argument-hint"] !== undefined && typeof data["argument-hint"] !== "string") {
      const kind = Array.isArray(data["argument-hint"]) ? "array" : typeof data["argument-hint"]
      problems.push(`argument-hint must be a quoted string (YAML parsed it as ${kind}); wrap the value in quotes`)
    }

    problems.push(
      ...SkillValidate.validateStandardSkill({
        name: skillName ?? path.basename(path.dirname(location)),
        description: description ?? "",
        location,
        compatibility,
        hasInvalidMetadata,
      }),
    )

    return problems
  }

  // Validate every `<dir>/<name>/SKILL.md` directly under `skillsDir` (the
  // built-in layout). Kept as the default entrypoint used by the build scripts.
  export async function check(skillsDir: string): Promise<Issue[]> {
    const entries = await fs.promises.readdir(skillsDir, { withFileTypes: true }).catch(() => [] as fs.Dirent[])
    const names = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()

    const issues: Issue[] = []
    for (const name of names) {
      const location = path.join(skillsDir, name, "SKILL.md")
      const problems = (await Bun.file(location).exists()) ? await validateFile(location) : ["missing SKILL.md"]
      if (problems.length) issues.push({ skill: name, location, problems })
    }
    return issues
  }

  function gitRoot(start: string): string {
    let cur = path.resolve(start)
    while (true) {
      if (fs.existsSync(path.join(cur, ".git"))) return cur
      const parent = path.dirname(cur)
      if (parent === cur) return path.resolve(start)
      cur = parent
    }
  }

  function ancestors(start: string, stop: string): string[] {
    const out: string[] = []
    let cur = path.resolve(start)
    const end = path.resolve(stop)
    while (true) {
      out.push(cur)
      if (cur === end || cur === path.dirname(cur)) break
      cur = path.dirname(cur)
    }
    return out
  }

  // Mirror the directories `Skill.state()` scans, so `--all` covers every place
  // a skill can be loaded from. Avoids importing `Global` (which has mkdir side
  // effects on import) by deriving the home/config paths locally.
  export function scopes(cwd: string = process.cwd()): ScopeSpec[] {
    const home = os.homedir()
    const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, ".config")
    const config = path.join(xdgConfig, "ax-code")
    const root = gitRoot(cwd)
    const externalDirs = [".claude", ".agents", ".opencode"]

    const out: ScopeSpec[] = [
      { scope: "builtin", dir: path.resolve(import.meta.dir, "../skills"), pattern: "*/SKILL.md", gate: "fail" },
    ]
    for (const d of externalDirs) {
      out.push({ scope: `user:${d}`, dir: path.join(home, d), pattern: "skills/**/SKILL.md", gate: "warn" })
    }
    for (const ancestor of ancestors(cwd, root)) {
      for (const d of externalDirs) {
        out.push({ scope: `project:${d}`, dir: path.join(ancestor, d), pattern: "skills/**/SKILL.md", gate: "warn" })
      }
    }
    const configDirs = [
      config,
      ...ancestors(cwd, root).map((d) => path.join(d, ".ax-code")),
      path.join(home, ".ax-code"),
    ]
    for (const dir of configDirs) {
      out.push({ scope: "config", dir, pattern: "{skill,skills}/**/SKILL.md", gate: "warn" })
    }

    // Dedupe by resolved directory; keep the first (strongest) scope label.
    const seen = new Set<string>()
    return out.filter((s) => {
      const key = path.resolve(s.dir)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  export async function checkAll(cwd?: string): Promise<ScopeResult[]> {
    const results: ScopeResult[] = []
    for (const spec of scopes(cwd)) {
      const exists = await fs.promises
        .stat(spec.dir)
        .then((s) => s.isDirectory())
        .catch(() => false)
      if (!exists) continue

      const issues: Issue[] = []
      let count = 0
      for await (const location of new Bun.Glob(spec.pattern).scan({ cwd: spec.dir, absolute: true })) {
        count++
        const problems = await validateFile(location)
        if (problems.length) issues.push({ skill: path.basename(path.dirname(location)), location, problems })
      }
      results.push({ ...spec, count, issues })
    }
    return results
  }
}

if (import.meta.main) {
  if (process.argv.includes("--all")) {
    const results = await SkillLint.checkAll()
    let failed = false
    let warned = false
    for (const r of results) {
      const status = r.issues.length === 0 ? "ok" : r.gate === "fail" ? "FAIL" : "warn"
      console.log(`[${status}] ${r.scope} — ${r.count} skill(s) — ${r.dir}`)
      for (const { skill, problems } of r.issues) {
        for (const problem of problems) console.log(`    - ${skill}: ${problem}`)
      }
      if (r.issues.length > 0) {
        if (r.gate === "fail") failed = true
        else warned = true
      }
    }
    if (results.length === 0) console.log("no skill scopes present")
    if (warned && !failed) console.log("\nwarnings only (non-builtin scopes do not fail the build)")
    if (failed) process.exit(1)
  } else {
    const skillsDir = path.resolve(import.meta.dir, "../skills")
    const issues = await SkillLint.check(skillsDir)
    if (issues.length === 0) {
      console.log("ok: built-in skills conform to the standard-skill contract")
    } else {
      console.error("Built-in skill validation failed:")
      for (const { skill, problems } of issues) {
        for (const problem of problems) console.error(`  - ${skill}: ${problem}`)
      }
      process.exit(1)
    }
  }
}
