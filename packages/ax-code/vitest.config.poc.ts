import { defineConfig } from "vitest/config"
import tsconfigPaths from "vite-tsconfig-paths"
import path from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const dir = __dirname

// Mirror the resolve overrides from script/build-node.ts so the Node path is exercised.
export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "#db": path.join(dir, "src/storage/db.node.ts"),
      bun: path.join(dir, "test-vitest/poc-bun-shim.ts"),
      "bun-pty": path.join(dir, "src/pty/bun-pty-node-stub.ts"),
      "drizzle-orm/bun-sqlite/migrator": path.join(dir, "test-vitest/poc-migrator.ts"),
      "drizzle-orm/bun-sqlite": require.resolve("drizzle-orm/node-sqlite"),
    },
  },
  test: {
    globals: false,
    include: ["test-vitest/**/*.test.{ts,tsx}"],
    setupFiles: [path.join(dir, "test-vitest/poc-setup.ts")],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: "forks",
  },
})
