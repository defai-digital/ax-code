import { defineConfig } from "drizzle-kit"
import os from "os"
import path from "path"

const dataDir =
  process.env.XDG_DATA_HOME ??
  (process.platform === "darwin"
    ? path.join(os.homedir(), "Library", "Application Support")
    : path.join(os.homedir(), ".local", "share"))

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/**/*.sql.ts",
  out: "./migration",
  dbCredentials: {
    url: path.join(dataDir, "ax-code", "ax-code.db"),
  },
})
