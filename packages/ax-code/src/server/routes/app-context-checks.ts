import { Filesystem } from "@/util/filesystem"
import path from "path"
import type { AppContextCheckData } from "./app-context-schema"

function quote(value: string) {
  return /\s/.test(value) ? JSON.stringify(value) : value
}

function relativeFromRoot(root: string, cwd: string) {
  return path.relative(root, cwd)
}

async function packageManager(cwd: string, root: string) {
  for await (const file of Filesystem.up({
    targets: ["pnpm-lock.yaml", "bun.lockb", "bun.lock", "yarn.lock", "package-lock.json"],
    start: cwd,
    stop: root,
  })) {
    const name = path.basename(file)
    if (name === "pnpm-lock.yaml") return "pnpm" as const
    if (name === "bun.lockb" || name === "bun.lock") return "bun" as const
    if (name === "yarn.lock") return "yarn" as const
    if (name === "package-lock.json") return "npm" as const
  }
  return "npm" as const
}

function checkLabel(name: string) {
  switch (name) {
    case "check":
      return "Check"
    case "typecheck":
      return "Typecheck"
    case "test":
      return "Test"
    case "lint":
      return "Lint"
    case "build":
      return "Build"
    case "verify":
      return "Verify"
    case "format":
      return "Format"
    default:
      return name
  }
}

function checkCommand(input: { manager: "pnpm" | "bun" | "yarn" | "npm"; root: string; cwd: string; name: string }) {
  const rel = relativeFromRoot(input.root, input.cwd)
  if (input.manager === "pnpm") {
    if (!rel) return `pnpm ${input.name}`
    return `pnpm --dir ${quote(rel)} ${input.name}`
  }
  if (input.manager === "bun") {
    if (!rel) return `bun run ${input.name}`
    return `bun --cwd ${quote(rel)} run ${input.name}`
  }
  if (input.manager === "yarn") {
    if (!rel) return `yarn ${input.name}`
    return `yarn --cwd ${quote(rel)} ${input.name}`
  }
  if (!rel) return `npm run ${input.name}`
  return `npm --prefix ${quote(rel)} run ${input.name}`
}

function checkTitle(input: { root: string; cwd: string; name: string }) {
  const rel = relativeFromRoot(input.root, input.cwd)
  if (!rel) return checkLabel(input.name)
  return `${rel} ${checkLabel(input.name).toLowerCase()}`
}

function inDir(root: string, cwd: string, command: string) {
  const rel = relativeFromRoot(root, cwd)
  if (!rel) return command
  return `cd ${quote(rel)} && ${command}`
}

function addCheck(
  out: AppContextCheckData[],
  seen: Set<string>,
  input: { root: string; cwd: string; name: string; command: string },
) {
  const command = input.command.trim()
  if (!command || seen.has(command)) return false
  seen.add(command)

  const rel = relativeFromRoot(input.root, input.cwd)
  out.push({
    id: `${rel || "."}:${input.name}:${out.length}`,
    title: checkTitle(input),
    command,
    cwd: input.cwd,
    source: path.resolve(input.cwd) === path.resolve(input.root) ? ("root" as const) : ("directory" as const),
  })
  return out.length >= 4
}

function makeTargets(text: string) {
  const out = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    if (!line || /^\s/.test(line)) continue
    if (line.startsWith("#")) continue
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*:/)
    if (!match) continue
    out.add(match[1])
  }
  return out
}

export async function contextChecks(input: { root: string; dir: string }) {
  const order = ["typecheck", "test", "lint", "build"] as const
  const rootPkg = path.join(input.root, "package.json")
  const nearest = (await Filesystem.findUp("package.json", input.dir, input.root))[0]
  const pkgs = Array.from(new Set([rootPkg, nearest].filter((item): item is string => !!item)))
  const seen = new Set<string>()
  const out: AppContextCheckData[] = []

  for (const file of pkgs) {
    const json = await Filesystem.readJson<{ scripts?: Record<string, string> }>(file).catch(() => null)
    const scripts = json?.scripts
    if (!scripts) continue

    const cwd = path.dirname(file)
    const manager = await packageManager(cwd, input.root)

    for (const name of order) {
      if (!scripts[name]) continue
      const command = checkCommand({ manager, root: input.root, cwd, name })
      if (addCheck(out, seen, { root: input.root, cwd, name, command })) return out
    }
  }

  const makeOrder = ["verify", "check", "test", "lint", "build", "typecheck"] as const
  const makeFiles = Array.from(
    new Set([path.join(input.root, "Makefile"), ...(await Filesystem.findUp("Makefile", input.dir, input.root))]),
  )
  for (const file of makeFiles) {
    if (!(await Filesystem.exists(file))) continue
    const text = await Filesystem.readText(file).catch(() => "")
    const targets = makeTargets(text)
    const cwd = path.dirname(file)
    for (const name of makeOrder) {
      if (!targets.has(name)) continue
      if (addCheck(out, seen, { root: input.root, cwd, name, command: inDir(input.root, cwd, `make ${name}`) }))
        return out
    }
  }

  const denoFiles = Array.from(
    new Set([
      path.join(input.root, "deno.json"),
      path.join(input.root, "deno.jsonc"),
      ...(await Filesystem.findUp("deno.json", input.dir, input.root)),
      ...(await Filesystem.findUp("deno.jsonc", input.dir, input.root)),
    ]),
  )
  for (const file of denoFiles) {
    if (!(await Filesystem.exists(file))) continue
    const cwd = path.dirname(file)
    if (addCheck(out, seen, { root: input.root, cwd, name: "check", command: inDir(input.root, cwd, "deno check .") }))
      return out
    if (addCheck(out, seen, { root: input.root, cwd, name: "test", command: inDir(input.root, cwd, "deno test") }))
      return out
    if (
      addCheck(out, seen, {
        root: input.root,
        cwd,
        name: "format",
        command: inDir(input.root, cwd, "deno fmt --check"),
      })
    )
      return out
  }

  const cargoFiles = Array.from(
    new Set([path.join(input.root, "Cargo.toml"), ...(await Filesystem.findUp("Cargo.toml", input.dir, input.root))]),
  )
  for (const file of cargoFiles) {
    if (!(await Filesystem.exists(file))) continue
    const cwd = path.dirname(file)
    if (addCheck(out, seen, { root: input.root, cwd, name: "test", command: inDir(input.root, cwd, "cargo test") }))
      return out
    if (addCheck(out, seen, { root: input.root, cwd, name: "check", command: inDir(input.root, cwd, "cargo check") }))
      return out
    if (addCheck(out, seen, { root: input.root, cwd, name: "build", command: inDir(input.root, cwd, "cargo build") }))
      return out
  }

  const goFiles = Array.from(
    new Set([path.join(input.root, "go.mod"), ...(await Filesystem.findUp("go.mod", input.dir, input.root))]),
  )
  for (const file of goFiles) {
    if (!(await Filesystem.exists(file))) continue
    const cwd = path.dirname(file)
    if (addCheck(out, seen, { root: input.root, cwd, name: "test", command: inDir(input.root, cwd, "go test ./...") }))
      return out
    if (
      addCheck(out, seen, { root: input.root, cwd, name: "build", command: inDir(input.root, cwd, "go build ./...") })
    )
      return out
  }

  return out
}
