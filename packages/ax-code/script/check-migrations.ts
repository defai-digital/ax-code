import { capture } from "./proc-compat"

// drizzle-kit check compares schema to migrations, exits non-zero if drift
const result = await capture(["pnpm", "exec", "drizzle-kit", "check"])

if (result.code !== 0) {
  console.error("Schema has changes not captured in migrations!")
  console.error("Run: pnpm exec drizzle-kit generate")
  console.error("")
  console.error(result.stderr)
  process.exit(1)
}

console.log("Migrations are up to date")
