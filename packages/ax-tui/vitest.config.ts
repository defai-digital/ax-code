import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const root = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      // Package self-reference: the spinner sources import "@defai-digital/ax-tui" at runtime
      // (and one test mocks it), which Node resolves via the package.json
      // name/exports but vite-node does not. Alias it to the package root.
      { find: /^@defai-digital\/ax-tui$/, replacement: `${root}index.js` },
      { find: /^@defai-digital\/ax-tui\/(.*)$/, replacement: `${root}$1` },
    ],
  },
  test: {
    include: ["test/**/*.test.ts", "script/**/*.test.ts"],
  },
})
