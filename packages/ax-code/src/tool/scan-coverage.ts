import { Instance } from "../project/instance"
import { Locale } from "../util/locale"
import { resolveToolFilePath } from "./file-path"

type SourceCoverage = "not_applicable" | "not_covered" | "limited"

export type ScanCoverageNotice = {
  lines: string[]
  metadata: {
    rustWorkspace: boolean
    pythonWorkspace: boolean
    rubyWorkspace: boolean
    rustSourceCoverage: SourceCoverage
    pythonSourceCoverage: SourceCoverage
    rubySourceCoverage: SourceCoverage
    languageScope: "js_ts_patterns" | "code_graph_symbols"
  }
}

function includesExtensionGlob(include: string[] | undefined, extension: string) {
  return include?.some((pattern) => pattern.includes(`.${extension}`) || pattern.includes(`${extension}}`)) ?? false
}

async function anyExists(candidates: string[]) {
  for (const candidate of candidates) {
    if (await Bun.file(resolveToolFilePath(candidate, Instance.directory)).exists()) return true
  }
  return false
}

function hasSourceFile(patterns: string[]) {
  for (const pattern of patterns) {
    try {
      const glob = new Bun.Glob(pattern)
      for (const _ of glob.scanSync({ cwd: Instance.directory, onlyFiles: true })) return true
    } catch {
      return false
    }
  }
  return false
}

async function detectedWorkspaces() {
  const rustWorkspace =
    (await Bun.file(resolveToolFilePath("Cargo.toml", Instance.directory)).exists()) ||
    hasSourceFile(["src/**/*.rs", "crates/**/*.rs"])
  const pythonWorkspace =
    (await anyExists(["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile"])) ||
    hasSourceFile(["*.py", "src/**/*.py", "tests/**/*.py", "python/**/*.py", "scripts/**/*.py", "app/**/*.py"])
  const rubyWorkspace =
    (await anyExists(["Gemfile", "Rakefile"])) ||
    hasSourceFile(["*.rb", "lib/**/*.rb", "spec/**/*.rb", "test/**/*.rb", "app/**/*.rb", "scripts/**/*.rb"])

  return {
    rustWorkspace,
    pythonWorkspace,
    rubyWorkspace,
  }
}

function coverageFor(input: { workspace: boolean; included: boolean }): SourceCoverage {
  if (!input.workspace) return "not_applicable"
  return input.included ? "limited" : "not_covered"
}

export async function dedupCoverageNotice(): Promise<ScanCoverageNotice> {
  const workspaces = await detectedWorkspaces()
  const lines: string[] = []

  if (workspaces.rustWorkspace) {
    lines.push(
      "Coverage note: Rust workspace detected. dedup_scan uses indexed symbols and signature heuristics, not Rust compiler semantics; a zero-cluster result is not a full Rust semantic duplication audit.",
    )
  }
  if (workspaces.pythonWorkspace) {
    lines.push(
      "Coverage note: Python workspace detected. dedup_scan uses indexed symbols and signature heuristics, not Python runtime/type semantics; a zero-cluster result is not a full Python semantic duplication audit.",
    )
  }
  if (workspaces.rubyWorkspace) {
    lines.push(
      "Coverage note: Ruby workspace detected. dedup_scan uses indexed symbols and signature heuristics, not Ruby runtime semantics; a zero-cluster result is not a full Ruby semantic duplication audit.",
    )
  }

  return {
    lines,
    metadata: {
      ...workspaces,
      rustSourceCoverage: workspaces.rustWorkspace ? "limited" : "not_applicable",
      pythonSourceCoverage: workspaces.pythonWorkspace ? "limited" : "not_applicable",
      rubySourceCoverage: workspaces.rubyWorkspace ? "limited" : "not_applicable",
      languageScope: "code_graph_symbols",
    },
  }
}

export async function scanCoverageNotice(input: { include?: string[] }): Promise<ScanCoverageNotice> {
  const workspaces = await detectedWorkspaces()
  const rustSourceCoverage = coverageFor({
    workspace: workspaces.rustWorkspace,
    included: includesExtensionGlob(input.include, "rs"),
  })
  const pythonSourceCoverage = coverageFor({
    workspace: workspaces.pythonWorkspace,
    included: includesExtensionGlob(input.include, "py"),
  })
  const rubySourceCoverage = coverageFor({
    workspace: workspaces.rubyWorkspace,
    included: includesExtensionGlob(input.include, "rb"),
  })
  const lines: string[] = []

  if (rustSourceCoverage === "limited") {
    lines.push(
      "Coverage note: Rust workspace detected. This scanner uses JS/TS-oriented pattern heuristics; Rust matches are limited and should be verified with Rust-aware review or cargo-based checks.",
    )
  } else if (rustSourceCoverage === "not_covered") {
    lines.push(
      "Coverage note: Rust workspace detected, but this scanner did not cover Rust source files. Use bounded Rust source review plus cargo check/test/clippy when Rust evidence is needed.",
    )
  }

  if (pythonSourceCoverage === "limited") {
    lines.push(
      "Coverage note: Python workspace detected. This scanner uses JS/TS-oriented pattern heuristics; Python matches are limited and should be verified with Python-aware review or pytest/ruff/mypy-based checks.",
    )
  } else if (pythonSourceCoverage === "not_covered") {
    lines.push(
      "Coverage note: Python workspace detected, but this scanner did not cover Python source files. Use bounded Python source review plus pytest/ruff/mypy when Python evidence is needed.",
    )
  }

  if (rubySourceCoverage === "limited") {
    lines.push(
      "Coverage note: Ruby workspace detected. This scanner uses JS/TS-oriented pattern heuristics; Ruby matches are limited and should be verified with Ruby-aware review or bundle exec ruby/rubocop/rspec checks.",
    )
  } else if (rubySourceCoverage === "not_covered") {
    lines.push(
      "Coverage note: Ruby workspace detected, but this scanner did not cover Ruby source files. Use bounded Ruby source review plus bundle exec ruby/rubocop/rspec when Ruby evidence is needed.",
    )
  }

  return {
    lines,
    metadata: {
      ...workspaces,
      rustSourceCoverage,
      pythonSourceCoverage,
      rubySourceCoverage,
      languageScope: "js_ts_patterns",
    },
  }
}

export function scanFilesSummary(count: number): string {
  return Locale.pluralize(count, "Scanned {} file", "Scanned {} files")
}
