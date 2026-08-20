/**
 * Design Check System
 *
 * Scans CSS/React code for design violations.
 *
 * Usage:
 *   import { runDesignCheck } from "../design-check"
 *   const result = await runDesignCheck(["src/"], { rules: { "no-hardcoded-colors": "error" } })
 */

import fs from "fs/promises"
import path from "path"
import { ALL_RULES } from "./rules"
import { Glob } from "../util/glob"
import type { DesignCheckConfig, CheckResult, FileResult, Violation } from "./types"

const DEFAULT_CONFIG: DesignCheckConfig = {
  rules: {
    "no-hardcoded-colors": "error",
    "no-raw-spacing": "warn",
    "no-inline-styles": "warn",
    "missing-alt-text": "error",
    "missing-form-labels": "error",
  },
  include: ["**/*.tsx", "**/*.jsx", "**/*.css", "**/*.html", "**/*.vue", "**/*.svelte"],
  ignore: ["node_modules", "dist", "build", ".next", "coverage"],
}

const SCANNABLE_EXTENSIONS = new Set([".tsx", ".jsx", ".css", ".html", ".vue", ".svelte"])

/**
 * Recursively find files matching extensions
 */
function ignored(relative: string, parts: string[], patterns: string[]): boolean {
  return patterns.some((pattern) => parts.includes(pattern) || Glob.match(pattern, relative))
}

function included(relative: string, patterns: string[]): boolean {
  return patterns.some((pattern) => Glob.match(pattern, relative))
}

function containsPath(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

async function findFiles(dir: string, ignore: string[], include: string[]): Promise<string[]> {
  const results: string[] = []
  const root = path.resolve(dir)

  async function walk(current: string) {
    if (!containsPath(root, current)) throw new Error(`Design-check path escapes scan root: ${current}`)
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const fullPath = path.resolve(current, entry.name)
      if (!containsPath(root, fullPath)) continue
      const relative = path.relative(root, fullPath).split(path.sep).join("/")
      const parts = relative.split("/")
      if (ignored(relative, parts, ignore)) continue
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (SCANNABLE_EXTENSIONS.has(path.extname(entry.name)) && included(relative, include)) {
        results.push(fullPath)
      }
    }
  }

  await walk(root)
  return results
}

/**
 * Run design check on specified paths
 */
export async function runDesignCheck(paths: string[], config?: Partial<DesignCheckConfig>): Promise<CheckResult> {
  const cfg: DesignCheckConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    rules: { ...DEFAULT_CONFIG.rules, ...config?.rules },
    include: config?.include ?? DEFAULT_CONFIG.include,
    ignore: config?.ignore ?? DEFAULT_CONFIG.ignore,
  }
  const knownRules = new Set(ALL_RULES.map((rule) => rule.name))
  for (const [name, severity] of Object.entries(cfg.rules)) {
    if (!knownRules.has(name)) throw new Error(`Unknown design-check rule: ${name}`)
    if (severity !== "error" && severity !== "warn" && severity !== "off") {
      throw new Error(`Invalid severity for ${name}: ${severity}`)
    }
  }

  // Find all files
  const allFiles = new Set<string>()
  for (const p of paths) {
    const stat = await fs.stat(p)
    if (stat.isDirectory()) {
      for (const file of await findFiles(p, cfg.ignore, cfg.include)) allFiles.add(file)
    } else if (SCANNABLE_EXTENSIONS.has(path.extname(p)) && included(path.basename(p), cfg.include)) {
      allFiles.add(p)
    }
  }

  // Check each file
  const fileResults: FileResult[] = []
  let totalErrors = 0
  let totalWarnings = 0

  for (const file of allFiles) {
    const content = await fs.readFile(file, "utf-8")
    if (!content) continue

    const violations: Violation[] = []

    for (const rule of ALL_RULES) {
      const severity = cfg.rules[rule.name as keyof typeof cfg.rules] ?? rule.defaultSeverity
      if (severity === "off") continue

      const ruleViolations = rule.check(content, file)
      for (const v of ruleViolations) {
        v.severity = severity
        violations.push(v)
      }
    }

    if (violations.length > 0) {
      fileResults.push({ file, violations })
      for (const v of violations) {
        if (v.severity === "error") totalErrors++
        else if (v.severity === "warn") totalWarnings++
      }
    }
  }

  return {
    files: fileResults,
    summary: {
      filesScanned: allFiles.size,
      totalErrors,
      totalWarnings,
    },
  }
}

/**
 * Format check result as readable string
 */
export function formatResult(result: CheckResult): string {
  const red = "\x1b[31m"
  const yellow = "\x1b[33m"
  const green = "\x1b[32m"
  const dim = "\x1b[2m"
  const bold = "\x1b[1m"
  const reset = "\x1b[0m"

  const lines: string[] = []

  for (const fileResult of result.files) {
    lines.push(`\n${bold}${fileResult.file}${reset}`)
    for (const v of fileResult.violations) {
      const icon = v.severity === "error" ? `${red}ERROR${reset}` : `${yellow}WARN${reset}`
      lines.push(`  ${dim}Line ${v.line}:${v.column}${reset}  ${icon}  ${v.rule} — ${v.message}`)
    }
  }

  lines.push("")
  const { totalErrors, totalWarnings, filesScanned } = result.summary
  const color = totalErrors > 0 ? red : totalWarnings > 0 ? yellow : green
  lines.push(`${color}${bold}${filesScanned} files scanned: ${totalErrors} errors, ${totalWarnings} warnings${reset}`)

  return lines.join("\n")
}

export type { DesignCheckConfig, CheckResult, FileResult, Violation, Rule, Severity } from "./types"
