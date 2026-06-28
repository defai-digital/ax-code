import { defineConfig } from "vitest/config"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const requireFromWeb = createRequire(path.resolve(__dirname, "../web/package.json"))
const react = (await import(pathToFileURL(requireFromWeb.resolve("@vitejs/plugin-react")).href)).default
const uiSrc = path.resolve(__dirname, "src")

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@openchamber/ui", replacement: uiSrc },
      { find: /^@\//, replacement: `${uiSrc}/` },
    ],
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx,js,jsx}"],
  },
})
