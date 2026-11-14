import fs from "node:fs"
import path from "node:path"
import { parse } from "yaml"
import { z } from "zod"

const workspaceConfig = z.object({ patchedDependencies: z.record(z.string(), z.string()).default({}) })

export function overlayDistributionPatches(input: {
  repoRoot: string
  workspaceNodeModules: string
  distributionRoot: string
  dependencies: Record<string, string>
}): string[] {
  const config = workspaceConfig.parse(parse(fs.readFileSync(path.join(input.repoRoot, "pnpm-workspace.yaml"), "utf8")))
  const applied: string[] = []
  for (const [spec, patchRel] of Object.entries(config.patchedDependencies)) {
    const name = spec.replace(/@[^@/]+$/, "")
    if (!(name in input.dependencies)) continue
    const packageRoot = path.join(input.workspaceNodeModules, name)
    const patchText = fs.readFileSync(path.join(input.repoRoot, patchRel), "utf8")
    const files = [...patchText.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1].trim())
    for (const relative of files) {
      const source = path.join(packageRoot, relative)
      const destination = path.join(input.distributionRoot, "node_modules", name, relative)
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.copyFileSync(source, destination)
    }
    applied.push(name)
  }
  return applied
}
