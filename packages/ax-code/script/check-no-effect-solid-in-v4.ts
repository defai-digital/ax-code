import fs from "node:fs/promises"
import path from "node:path"

const ext = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"])

function imports(text: string) {
  const out = [] as string[]
  for (const match of text.matchAll(/from\s+["']([^"']+)["']/g)) out.push(match[1] ?? "")
  for (const match of text.matchAll(/import\s+["']([^"']+)["']/g)) out.push(match[1] ?? "")
  return out
}

function rule(spec: string): V4Guardrails.Rule | undefined {
  if (spec === "effect" || spec.startsWith("effect/") || spec.startsWith("@effect/")) return "effect"
  if (spec === "solid-js" || spec.startsWith("solid-js/") || spec.startsWith("@solid-primitives/")) return "solid"
  if (spec.startsWith("@opentui/")) return "opentui"
}

async function exists(dir: string) {
  return fs
    .stat(dir)
    .then(() => true)
    .catch(() => false)
}

function skip(file: string) {
  return (
    file.includes("/node_modules/") || file.includes("/dist/") || file.includes("/.git/") || file.includes("/.turbo/")
  )
}

export namespace V4Guardrails {
  export const Directories = [
    "src/runtime",
    "src/cli/cmd/tui-v4",
    "src/cli/cmd/tui/state",
    "src/cli/cmd/tui/input",
    "src/cli/cmd/tui/native",
  ] as const
  export type Rule = "effect" | "solid" | "opentui"

  export interface Violation {
    file: string
    spec: string
    rule: Rule
  }

  export async function listFiles(root: string) {
    const out = [] as string[]
    for (const dir of Directories) {
      const base = path.join(root, dir)
      if (!(await exists(base))) continue
      for await (const file of new Bun.Glob("**/*").scan({ cwd: base, absolute: true })) {
        if (skip(file)) continue
        if (!ext.has(path.extname(file))) continue
        out.push(path.relative(root, file))
      }
    }
    return out.sort()
  }

  export async function check(root: string): Promise<Violation[]> {
    const out = [] as Violation[]
    for (const file of await listFiles(root)) {
      const text = await Bun.file(path.join(root, file)).text()
      for (const spec of imports(text)) {
        const hit = rule(spec)
        if (!hit) continue
        out.push({ file, spec, rule: hit })
      }
    }
    return out
  }

  export function format(input: Violation) {
    return `${input.file} imports ${input.spec} (${input.rule})`
  }
}

if (import.meta.main) {
  const root = path.resolve(import.meta.dir, "..")
  const violations = await V4Guardrails.check(root)
  if (violations.length === 0) {
    console.log("ok: no v4 guardrail violations found")
  } else {
    console.log("# V4 Guardrail Violations")
    for (const item of violations) {
      console.log(`- ${V4Guardrails.format(item)}`)
    }
    process.exit(1)
  }
}
