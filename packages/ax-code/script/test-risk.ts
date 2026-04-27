import path from "path"
import { check, list, pick } from "./test-group"

const risk = {
  bootstrap: ["test/cli/boot.test.ts", "test/cli/smoke.test.ts"],
  sandbox: ["test/isolation/isolation.test.ts", "test/tool/bash.test.ts", "test/permission/next.test.ts"],
  provider: [
    "test/provider/models.test.ts",
    "test/provider/transform.test.ts",
    "test/session/llm.test.ts",
    "test/session/structured-output.test.ts",
    "test/session/structured-output-integration.test.ts",
  ],
  persistence: [
    "test/session/diff-recovery.test.ts",
    "test/session/message-recovery.test.ts",
    "test/session/prompt-flow.test.ts",
    "test/session/prompt-resume.test.ts",
    "test/session/revert-compact.test.ts",
    "test/session/session-recovery.test.ts",
  ],
  migration: ["test/cli/boot.test.ts", "test/storage/json-migration.test.ts"],
} satisfies Record<string, string[]>

function line(name: string, files: string[], live: Set<string>) {
  const det = files.filter((file) => !live.has(file)).length
  const dyn = files.filter((file) => live.has(file)).length
  return `- ${name}: ${files.length} files (${det} deterministic, ${dyn} live)`
}

async function main() {
  const all = await list()
  check(all)
  const live = new Set(pick(all, "live"))
  const miss = Object.values(risk)
    .flat()
    .filter((file) => !all.includes(file))
  if (miss.length) throw new Error(`Missing risk tests:\n${miss.join("\n")}`)

  const out = [] as string[]
  out.push("## ax-code risk map")
  out.push("")
  for (const [name, files] of Object.entries(risk)) out.push(line(name, files, live))
  out.push("")
  out.push("Files:")
  for (const [name, files] of Object.entries(risk)) {
    out.push(`- ${name}: ${files.join(", ")}`)
  }
  out.push("")

  const text = out.join("\n")
  console.log(text)
  const file = process.env["GITHUB_STEP_SUMMARY"]
  if (file) {
    await Bun.write(
      file,
      `${await Bun.file(file)
        .text()
        .catch(() => "")}${text}\n`,
    )
  }

  const target = path.join(import.meta.dir, "..", ".tmp", "test-risk.md")
  await Bun.write(target, text)
}

await main()
