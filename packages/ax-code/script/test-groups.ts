import { check, list, pick, root } from "./test-group"

async function main() {
  const name = process.argv[2]
  if (!name) throw new Error("Missing test group")

  const all = await list()
  check(all)
  const next = pick(all, name)
  if (next.length === 0) {
    console.log(`No tests in group: ${name}`)
    return
  }

  console.log(`Running ${name} tests (${next.length})`)
  const proc = Bun.spawn([process.execPath, "test", "--timeout", "30000", ...next], {
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  const code = await proc.exited
  process.exit(code)
}

await main()
