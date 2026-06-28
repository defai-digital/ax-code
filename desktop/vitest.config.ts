import { defineConfig } from "vitest/config"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const requireFromWeb = createRequire(path.join(__dirname, "packages/web/package.json"))
const react = (await import(pathToFileURL(requireFromWeb.resolve("@vitejs/plugin-react")).href)).default
const uiSrc = path.resolve(__dirname, "packages/ui/src")

// Single root config that runs every workspace's tests under Vitest across
// three projects:
//  - ui:   React/zustand units, jsdom (SUT reads window.location, tests touch
//          localStorage/timers). Components are exercised via renderToStaticMarkup
//          or called directly, but jsdom keeps browser globals available.
//  - web:  Express/server units, node env. Reuses packages/web/vite.config.ts so
//          its aliases + react plugin match the build exactly.
//  - node: plain Node scripts (scripts/**, packages/electron/**) as .mjs, node env.
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: {
          alias: [
            { find: "@openchamber/ui", replacement: uiSrc },
            { find: /^@\//, replacement: `${uiSrc}/` },
          ],
        },
        test: {
          name: "ui",
          root: path.resolve(__dirname, "packages/ui"),
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx,js,jsx}"],
        },
      },
      {
        extends: path.resolve(__dirname, "packages/web/vite.config.ts"),
        test: {
          name: "web",
          root: path.resolve(__dirname, "packages/web"),
          environment: "node",
          include: ["**/*.test.{ts,tsx,js,jsx,mjs}"],
        },
      },
      {
        test: {
          name: "node",
          root: __dirname,
          environment: "node",
          include: ["scripts/**/*.test.mjs", "packages/electron/**/*.test.{mjs,js,ts}"],
        },
      },
    ],
  },
})
