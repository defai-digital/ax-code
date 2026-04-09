/**
 * Project analyzer for AX.md context generation
 * Ported from ax-cli's ProjectAnalyzer
 *
 * Detects project language, tech stack, structure, scripts, and conventions
 * Uses Bun APIs for file I/O
 */

import path from "path"
import fs from "fs"

export type ComplexityLevel = "small" | "medium" | "large" | "enterprise"
export type DepthLevel = "basic" | "standard" | "full" | "security"

export interface ComplexityScore {
  level: ComplexityLevel
  score: number
  fileCount: number
  linesOfCode: number
  dependencyCount: number
}

export interface CodeConventions {
  moduleSystem: "esm" | "cjs"
  importExtension?: string
  testFramework?: string
  validation?: string
  linter?: string
  strict?: boolean
  packageManager?: string
}

export interface ProjectScripts {
  install?: string
  build?: string
  test?: string
  lint?: string
  dev?: string
  typecheck?: string
  custom?: Record<string, string>
}

export interface ProjectInfo {
  schemaVersion: string
  name: string
  version?: string
  description?: string
  primaryLanguage: string
  techStack: string[]
  projectType: string
  entryPoint?: string
  complexity?: ComplexityScore
  directories: {
    source?: string
    tests?: string
    config?: string
    docs?: string
    dist?: string
  }
  keyFiles: Record<string, string>
  conventions: CodeConventions
  scripts: ProjectScripts
  packageManager?: string
  lastAnalyzed: string
  cicdPlatform?: string
  gotchas: string[]
  runtimeTargets: string[]
}

interface PackageJson {
  name?: string
  version?: string
  type?: string
  description?: string
  main?: string
  bin?: string | Record<string, string>
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  exports?: unknown
  packageManager?: string
  [key: string]: unknown
}

export async function analyze(root: string): Promise<ProjectInfo> {
  const pkg = await readJson<PackageJson>(path.join(root, "package.json"))

  const info: ProjectInfo = {
    schemaVersion: "2.0",
    name: pkg?.name ?? path.basename(root),
    version: pkg?.version,
    description: pkg?.description,
    primaryLanguage: detectLanguage(root),
    techStack: detectTechStack(root, pkg),
    projectType: detectProjectType(root, pkg),
    entryPoint: detectEntryPoint(pkg),
    directories: detectDirectories(root),
    keyFiles: detectKeyFiles(root),
    conventions: detectConventions(root, pkg),
    scripts: detectScripts(pkg),
    packageManager: detectPackageManager(root, pkg),
    lastAnalyzed: new Date().toISOString(),
    cicdPlatform: detectCICD(root),
    gotchas: detectGotchas(root, pkg),
    runtimeTargets: detectRuntimeTargets(root, pkg),
  }

  info.complexity = await calculateComplexity(root, info)

  return info
}

async function readJson<T>(filepath: string): Promise<T | null> {
  // Skip the exists() probe. It adds a TOCTOU window (the file can be
  // deleted or truncated between exists() and json()) and the catch
  // below already handles ENOENT. Removing the probe also means one
  // fewer syscall on the happy path.
  try {
    return (await Bun.file(filepath).json()) as T
  } catch {
    return null
  }
}

function exists(filepath: string): boolean {
  try {
    fs.statSync(filepath)
    return true
  } catch {
    return false
  }
}

function pathExists(root: string, ...segments: string[]): boolean {
  try {
    return exists(path.join(root, ...segments))
  } catch {
    return false
  }
}

function detectLanguage(root: string): string {
  if (pathExists(root, "tsconfig.json")) return "TypeScript"
  if (pathExists(root, "package.json")) return "JavaScript"
  if (pathExists(root, "requirements.txt") || pathExists(root, "pyproject.toml")) return "Python"
  if (pathExists(root, "go.mod")) return "Go"
  if (pathExists(root, "Cargo.toml")) return "Rust"
  if (pathExists(root, "build.gradle") || pathExists(root, "pom.xml")) return "Java"
  return "Unknown"
}

function detectTechStack(root: string, pkg: PackageJson | null): string[] {
  const stack: string[] = []
  if (!pkg) return stack

  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const map: Record<string, string> = {
    react: "React",
    vue: "Vue",
    "@angular/core": "Angular",
    svelte: "Svelte",
    "solid-js": "SolidJS",
    next: "Next.js",
    nuxt: "Nuxt",
    express: "Express",
    fastify: "Fastify",
    hono: "Hono",
    "@nestjs/core": "NestJS",
    vitest: "Vitest",
    jest: "Jest",
    playwright: "Playwright",
    vite: "Vite",
    webpack: "Webpack",
    esbuild: "ESBuild",
    zod: "Zod",
    prisma: "Prisma",
    "drizzle-orm": "Drizzle",
    mongoose: "Mongoose",
    effect: "Effect",
    ai: "Vercel AI SDK",
  }

  for (const [dep, name] of Object.entries(map)) {
    if (deps[dep]) stack.push(name)
  }

  if (pkg.type === "module") stack.push("ESM")
  if (pathExists(root, "tsconfig.json")) stack.push("TypeScript")
  if (pathExists(root, "bunfig.toml")) stack.push("Bun")

  return [...new Set(stack)]
}

function detectProjectType(root: string, pkg: PackageJson | null): string {
  if (pkg?.bin) return "cli"
  if (pathExists(root, "src/app") || pathExists(root, "app")) return "web-app"
  if (pathExists(root, "src/server") || pathExists(root, "server")) return "api"
  if (pkg?.main || pkg?.exports) return "library"
  return "application"
}

function detectEntryPoint(pkg: PackageJson | null): string | undefined {
  if (!pkg) return undefined
  if (typeof pkg.bin === "string") return pkg.bin
  if (typeof pkg.bin === "object") return Object.values(pkg.bin)[0]
  if (typeof pkg.main === "string") return pkg.main
  return undefined
}

function detectDirectories(root: string): ProjectInfo["directories"] {
  const dirs: ProjectInfo["directories"] = {}
  const checks: [keyof ProjectInfo["directories"], string[]][] = [
    ["source", ["src", "lib", "app"]],
    ["tests", ["test", "tests", "__tests__", "spec"]],
    ["config", ["config", ".config"]],
    ["docs", ["docs", "doc", "documentation"]],
    ["dist", ["dist", "build", "out", "output"]],
  ]

  for (const [key, candidates] of checks) {
    for (const dir of candidates) {
      if (pathExists(root, dir)) {
        dirs[key] = dir
        break
      }
    }
  }

  return dirs
}

function detectKeyFiles(root: string): Record<string, string> {
  const files: Record<string, string> = {}
  const checks: [string, string][] = [
    ["package.json", "Package manifest"],
    ["tsconfig.json", "TypeScript config"],
    ["Dockerfile", "Docker containerization"],
    ["docker-compose.yml", "Docker Compose"],
    [".env.example", "Environment template"],
    ["turbo.json", "Turbo monorepo config"],
    ["bunfig.toml", "Bun config"],
  ]

  for (const [file, desc] of checks) {
    if (pathExists(root, file)) files[file] = desc
  }

  return files
}

function detectConventions(root: string, pkg: PackageJson | null): CodeConventions {
  const conventions: CodeConventions = {
    moduleSystem: pkg?.type === "module" ? "esm" : "cjs",
  }

  if (conventions.moduleSystem === "esm") {
    conventions.importExtension = ".js"
  }

  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies }
  if (deps.vitest) conventions.testFramework = "vitest"
  else if (deps.jest) conventions.testFramework = "jest"
  else if (deps.mocha) conventions.testFramework = "mocha"

  if (deps.zod) conventions.validation = "zod"
  else if (deps.yup) conventions.validation = "yup"
  else if (deps.joi) conventions.validation = "joi"

  if (deps.eslint || pathExists(root, ".eslintrc.json") || pathExists(root, "eslint.config.js")) {
    conventions.linter = "eslint"
  } else if (deps.biome || pathExists(root, "biome.json")) {
    conventions.linter = "biome"
  }

  return conventions
}

function detectScripts(pkg: PackageJson | null): ProjectScripts {
  if (!pkg?.scripts) return {}

  const { build, test, lint, dev, typecheck, ...rest } = pkg.scripts
  const custom: Record<string, string> = {}
  const skip = ["prepare", "preinstall", "postinstall", "prepublish", "prepublishOnly"]

  for (const [name, cmd] of Object.entries(rest)) {
    if (skip.includes(name) || name.startsWith("pre") || name.startsWith("post")) continue
    custom[name] = cmd
  }

  return {
    install: "install",
    build: build ? "build" : undefined,
    test: test ? "test" : undefined,
    lint: lint ? "lint" : undefined,
    dev: dev ? "dev" : undefined,
    typecheck: typecheck ? "typecheck" : undefined,
    custom: Object.keys(custom).length > 0 ? custom : undefined,
  }
}

function detectPackageManager(root: string, pkg: PackageJson | null): string {
  if (pkg?.packageManager) {
    const pm = pkg.packageManager.split("@")[0]
    if (pm) return pm
  }
  if (pathExists(root, "bun.lock") || pathExists(root, "bunfig.toml")) return "bun"
  if (pathExists(root, "pnpm-lock.yaml")) return "pnpm"
  if (pathExists(root, "yarn.lock")) return "yarn"
  return "npm"
}

function detectCICD(root: string): string | undefined {
  if (pathExists(root, ".github/workflows")) return "github-actions"
  if (pathExists(root, ".gitlab-ci.yml")) return "gitlab-ci"
  if (pathExists(root, ".circleci")) return "circleci"
  if (pathExists(root, "Jenkinsfile")) return "jenkins"
  return undefined
}

function detectGotchas(root: string, pkg: PackageJson | null): string[] {
  const gotchas: string[] = []
  const conventions = detectConventions(root, pkg)

  if (conventions.moduleSystem === "esm" && conventions.importExtension === ".js") {
    gotchas.push("ESM imports require .js extension even for .ts source files")
  }
  if (pathExists(root, "turbo.json") || pathExists(root, "pnpm-workspace.yaml") || pathExists(root, "lerna.json")) {
    gotchas.push("Monorepo — run commands from package directories, not root")
  }

  return gotchas
}

function detectRuntimeTargets(root: string, pkg: PackageJson | null): string[] {
  const targets: string[] = []
  if (pathExists(root, "bunfig.toml") || pkg?.packageManager?.startsWith("bun")) targets.push("bun")
  if (pathExists(root, ".node-version") || pathExists(root, ".nvmrc")) targets.push("node")
  if (pathExists(root, "deno.json") || pathExists(root, "deno.jsonc")) targets.push("deno")
  if (targets.length === 0) targets.push("node")
  return targets
}

async function calculateComplexity(root: string, info: ProjectInfo): Promise<ComplexityScore> {
  let fileCount = 0
  let loc = 0

  const sourceDir = info.directories.source
  if (sourceDir) {
    try {
      const glob = new Bun.Glob("**/*.{ts,tsx,js,jsx,py,go,rs}")
      const batch: string[] = []
      const cwd = path.join(root, sourceDir)
      for await (const file of glob.scan({ cwd, onlyFiles: true })) {
        batch.push(file)
        if (batch.length >= 50 || fileCount + batch.length > 5000) {
          const results = await Promise.all(batch.map((f) => Bun.file(path.join(cwd, f)).text().catch(() => "")))
          for (const content of results) {
            fileCount++
            const lines = content.split("\n")
            loc += content.endsWith("\n") ? lines.length - 1 : lines.length
          }
          batch.length = 0
          if (fileCount > 5000) break
        }
      }
      if (batch.length > 0) {
        const results = await Promise.all(batch.map((f) => Bun.file(path.join(cwd, f)).text().catch(() => "")))
        for (const content of results) {
          fileCount++
          const lines = content.split("\n")
          loc += content.endsWith("\n") ? lines.length - 1 : lines.length
        }
      }
    } catch {
      // fallback
    }
  }

  const pkg = await readJson<PackageJson>(path.join(root, "package.json"))
  const depCount = Object.keys({
    ...pkg?.dependencies,
    ...pkg?.devDependencies,
  }).length

  const score = Math.min(100, fileCount * 0.05 + loc * 0.001 + depCount * 0.5)

  const level: ComplexityLevel =
    score < 15 ? "small" : score < 40 ? "medium" : score < 70 ? "large" : "enterprise"

  return { level, score: Math.round(score), fileCount, linesOfCode: loc, dependencyCount: depCount }
}
