/**
 * Project verification policy pack (ADR-048 / agentic-runtime Phase 1).
 *
 * Pure policy helpers for ecosystem detection, preferred check commands, and
 * classifying whether a shell command can count as "verification" evidence.
 * Callers that need filesystem I/O use `resolvePreferredCommands`.
 */

import fs from "fs/promises"
import path from "path"
import { resolveCommands } from "../planner/verification/runner"
import { decodePackageJsonObject, packageJsonStringMap, parsePackageJsonObject } from "../util/package-json"

export namespace VerificationPolicy {
  export type Ecosystem = "node" | "rust" | "go" | "python" | "unknown"

  export type PackageManager = "npm" | "pnpm" | "yarn" | "bun"

  export type VerificationSignals = {
    hasPackageJson?: boolean
    hasCargoToml?: boolean
    hasGoMod?: boolean
    hasPyproject?: boolean
    hasRequirementsTxt?: boolean
    packageManager?: PackageManager
    scripts?: {
      typecheck?: boolean
      lint?: boolean
      test?: boolean
    }
  }

  export type PreferredCommands = {
    ecosystem: Ecosystem
    typecheck: string | null
    lint: string | null
    test: string | null
    preferred: string[]
  }

  /** Observation / no-op commands that never exercise a change. */
  const TRIVIAL_COMMANDS: ReadonlySet<string> = new Set([
    "echo",
    "printf",
    "true",
    ":",
    "sleep",
    "pwd",
    "cd",
    "touch",
    "exit",
    "ls",
    "cat",
    "head",
    "tail",
    "less",
    "more",
    "tree",
    "find",
    "fd",
    "stat",
    "file",
    "wc",
    "du",
    "df",
    "realpath",
    "readlink",
    "dirname",
    "basename",
    "which",
    "whereis",
    "type",
    "grep",
    "egrep",
    "fgrep",
    "rg",
    "ag",
    "sed",
    "awk",
    "cut",
    "sort",
    "uniq",
    "tr",
    "diff",
    "cmp",
    "jq",
    "yq",
    "env",
    "printenv",
    "whoami",
    "hostname",
    "uname",
    "date",
    "ps",
    "git",
  ])

  /** Tokens that strongly suggest a real verification run. */
  const VERIFICATION_HINTS =
    /\b(test|tests|typecheck|tsc|lint|eslint|clippy|cargo\s+(test|check|clippy)|pytest|vitest|jest|mocha|go\s+test|mypy|ruff|pyright|build|compile|check)\b/i

  export function detectEcosystem(signals: VerificationSignals): Ecosystem {
    if (signals.hasPackageJson) return "node"
    if (signals.hasCargoToml) return "rust"
    if (signals.hasGoMod) return "go"
    if (signals.hasPyproject || signals.hasRequirementsTxt) return "python"
    return "unknown"
  }

  export function preferredCommands(signals: VerificationSignals): PreferredCommands {
    const ecosystem = detectEcosystem(signals)
    const pm = signals.packageManager ?? "npm"
    let typecheck: string | null = null
    let lint: string | null = null
    let test: string | null = null

    if (ecosystem === "node") {
      if (signals.scripts?.typecheck) typecheck = `${pm} run typecheck`
      if (signals.scripts?.lint) lint = `${pm} run lint`
      if (signals.scripts?.test) test = pm === "npm" || pm === "pnpm" || pm === "yarn" ? `${pm} test` : `${pm} test`
    } else if (ecosystem === "rust") {
      typecheck = "cargo check"
      lint = "cargo clippy --all-targets --all-features -- -D warnings"
      test = "cargo test"
    } else if (ecosystem === "go") {
      typecheck = "go build ./..."
      test = "go test ./..."
    } else if (ecosystem === "python") {
      test = "pytest"
      lint = "ruff check ."
      typecheck = "pyright"
    }

    const preferred = [test, typecheck, lint].filter((cmd): cmd is string => Boolean(cmd))
    return { ecosystem, typecheck, lint, test, preferred }
  }

  function firstWord(segment: string) {
    const tokens = segment.trim().split(/\s+/)
    for (const token of tokens) {
      const cleaned = token.replace(/^[({]+/, "")
      if (cleaned === "") continue
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(cleaned)) continue
      return cleaned
    }
    return ""
  }

  export function isTrivialVerificationCommand(command: string): boolean {
    const segments = command.split(/&&|\|\||;|\||\n/)
    for (const segment of segments) {
      const word = firstWord(segment)
      if (!word) continue
      if (!TRIVIAL_COMMANDS.has(word)) return false
    }
    return true
  }

  export function looksLikeVerificationCommand(command: string): boolean {
    if (!command.trim()) return false
    if (isTrivialVerificationCommand(command)) return false
    return VERIFICATION_HINTS.test(command)
  }

  export function renderVerificationProtocol(commands: PreferredCommands): string {
    const preferred =
      commands.preferred.length > 0
        ? commands.preferred.map((cmd) => `    - \`${cmd}\``).join("\n")
        : "    - run the project's tests, typecheck, or build for the stack you touched"

    return [
      `<verification_protocol>`,
      `  Sandwich non-trivial work: plan (or a short decision frame) → implement → verify.`,
      `  After file mutations, run project verification before claiming the task or goal is done.`,
      `  Prefer the verify_project tool when available; otherwise run a real check (not ls/cat/git status).`,
      `  Preferred checks for this workspace (${commands.ecosystem}):`,
      preferred,
      `  Observation-only commands never count as verification.`,
      `</verification_protocol>`,
    ].join("\n")
  }

  async function fileExists(file: string): Promise<boolean> {
    return fs
      .access(file)
      .then(() => true)
      .catch(() => false)
  }

  async function detectPackageManager(cwd: string, pkg: Record<string, unknown>): Promise<PackageManager> {
    const declared = typeof pkg.packageManager === "string" ? pkg.packageManager.split("@")[0] : undefined
    if (declared === "pnpm" || declared === "yarn" || declared === "bun" || declared === "npm") return declared
    if (await fileExists(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm"
    if ((await fileExists(path.join(cwd, "bun.lock"))) || (await fileExists(path.join(cwd, "bun.lockb")))) return "bun"
    if (await fileExists(path.join(cwd, "yarn.lock"))) return "yarn"
    return "npm"
  }

  /**
   * Resolve preferred commands from the workspace filesystem.
   * Uses planner runner resolution when package/cargo scripts are present.
   */
  export async function resolvePreferredCommands(cwd: string): Promise<PreferredCommands> {
    const root = path.resolve(cwd)
    const hasPackageJson = await fileExists(path.join(root, "package.json"))
    const hasCargoToml = await fileExists(path.join(root, "Cargo.toml"))
    const hasGoMod = await fileExists(path.join(root, "go.mod"))
    const hasPyproject = await fileExists(path.join(root, "pyproject.toml"))
    const hasRequirementsTxt = await fileExists(path.join(root, "requirements.txt"))

    let packageManager: PackageManager | undefined
    let scripts: VerificationSignals["scripts"]

    if (hasPackageJson) {
      try {
        const raw = await fs.readFile(path.join(root, "package.json"), "utf8")
        const pkg = parsePackageJsonObject(raw) ?? {}
        packageManager = await detectPackageManager(root, pkg)
        const scriptMap = packageJsonStringMap(decodePackageJsonObject(pkg).scripts)
        scripts = {
          typecheck: Boolean(scriptMap.typecheck),
          lint: Boolean(scriptMap.lint),
          test: Boolean(scriptMap.test),
        }
      } catch {
        packageManager = "npm"
      }
    }

    const signals: VerificationSignals = {
      hasPackageJson,
      hasCargoToml,
      hasGoMod,
      hasPyproject,
      hasRequirementsTxt,
      packageManager,
      scripts,
    }

    // Prefer runner-resolved commands when available (handles monorepo / cargo root).
    const resolved = await resolveCommands(root)
    if (hasPackageJson || resolved.typecheck || resolved.lint || resolved.test) {
      const preferred = [resolved.test, resolved.typecheck, resolved.lint].filter((cmd): cmd is string => Boolean(cmd))
      return {
        ecosystem: detectEcosystem(signals),
        typecheck: resolved.typecheck,
        lint: resolved.lint,
        test: resolved.test,
        preferred,
      }
    }

    return preferredCommands(signals)
  }
}
