import { spawnSync } from "node:child_process"

const protectedPrefixes = [".internal/"]

function runGit(args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })

  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim()
    throw new Error(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`)
  }

  return result.stdout
}

function main() {
  const trackedFiles = runGit(["ls-files"])
    .split("\n")
    .filter(Boolean)

  const violations = trackedFiles.filter((file) =>
    protectedPrefixes.some((prefix) => file.startsWith(prefix)),
  )

  if (violations.length > 0) {
    console.error("Internal-only files are tracked and would be included in source releases:")
    for (const file of violations) {
      console.error(`- ${file}`)
    }
    console.error("Move them out of Git tracking with: git rm --cached <path>")
    process.exit(1)
  }

  console.log("Internal boundary check passed.")
}

main()
