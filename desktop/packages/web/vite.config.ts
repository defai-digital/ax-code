import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readFileSync } from "node:fs"
import { themeStoragePlugin } from "../../vite-theme-plugin"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf-8"))
const reactScanToggle = (process.env.VITE_ENABLE_REACT_SCAN ?? "").toLowerCase()
const enableReactScan =
  reactScanToggle === "1" || reactScanToggle === "true" || reactScanToggle === "on" || reactScanToggle === "yes"
const nodeModulesSegment = "node_modules/"
const configuredDevServerPort = Number.parseInt(process.env.AX_CODE_DESKTOP_RENDERER_PORT ?? "5173", 10)
const devServerPort =
  Number.isFinite(configuredDevServerPort) && configuredDevServerPort > 0 ? configuredDevServerPort : 5173
const highRiskBuildWarningPatterns = [
  /will produce a circular dependency between chunks/i,
  /broken execution order/i,
]

process.noDeprecation = true

function normalizeModuleId(id: string): string {
  return id.split(path.sep).join("/")
}

function getAppChunkName(id: string): string | undefined {
  const normalizedId = normalizeModuleId(id)
  if (normalizedId.includes("/desktop/packages/ui/src/stores/useConfigStore")) return "app-config-store"
  return undefined
}

function getBuildWarningMessage(warning: unknown): string {
  if (typeof warning === "string") return warning
  if (warning && typeof warning === "object" && "message" in warning) {
    const message = (warning as { message?: unknown }).message
    return typeof message === "string" ? message : String(message ?? warning)
  }
  return String(warning)
}

function isHighRiskBuildWarning(warning: unknown): boolean {
  const message = getBuildWarningMessage(warning)
  return highRiskBuildWarningPatterns.some((pattern) => pattern.test(message))
}

function getPackageNameFromNodeModuleId(id: string): string | null {
  const markerIndex = id.lastIndexOf(nodeModulesSegment)
  if (markerIndex < 0) {
    return null
  }

  const match = id.slice(markerIndex + nodeModulesSegment.length)
  const segments = match.split("/")
  if (!segments[0]) {
    return null
  }

  return match.startsWith("@") ? `${segments[0]}/${segments[1]}` : segments[0]
}

function getVendorChunkName(packageName: string): string | undefined {
  if (packageName === "react" || packageName === "react-dom" || packageName === "scheduler") return "vendor-react"
  if (packageName === "zustand" || packageName === "use-sync-external-store") return "vendor-state"
  if (packageName === "@ax-code/sdk") return "vendor-ax-code-sdk"
  if (packageName === "@base-ui/react" || packageName.startsWith("@base-ui") || packageName.startsWith("@radix-ui"))
    return "vendor-ui"
  if (packageName.startsWith("@codemirror") || packageName.startsWith("@lezer")) return "vendor-codemirror"
  if (packageName === "@shikijs/langs") return "vendor-shiki-langs"
  if (packageName === "@shikijs/themes") return "vendor-shiki-themes"
  if (packageName.startsWith("@shikijs") || packageName === "shiki") return "vendor-shiki-core"
  if (
    packageName.includes("remark") ||
    packageName.includes("rehype") ||
    packageName.includes("micromark") ||
    packageName === "react-markdown" ||
    packageName === "unified"
  )
    return "vendor-markdown"
  if (
    packageName.includes("react-syntax-highlighter") ||
    packageName.includes("highlight.js") ||
    packageName === "refractor" ||
    packageName === "prismjs"
  )
    return "vendor-syntax"
  return undefined
}

export default defineConfig({
  root: path.resolve(__dirname, "."),
  plugins: [
    react({
      babel: {
        plugins: ["babel-plugin-react-compiler"],
      },
    }),
    {
      name: "inject-react-scan-script",
      transformIndexHtml() {
        if (!enableReactScan) {
          return
        }
        return [
          {
            tag: "script",
            attrs: {
              crossorigin: "anonymous",
              src: "//unpkg.com/react-scan/dist/auto.global.js",
            },
            injectTo: "head-prepend",
          },
        ]
      },
    },
    themeStoragePlugin(),
  ],
  resolve: {
    alias: [
      {
        find: /^@ax-code\/sdk\/v2$/,
        replacement: path.resolve(__dirname, "../../../packages/sdk/js/dist/v2/index.js"),
      },
      { find: "@openchamber/ui", replacement: path.resolve(__dirname, "../ui/src") },
      { find: "@web", replacement: path.resolve(__dirname, "./src") },
      { find: "@", replacement: path.resolve(__dirname, "../ui/src") },
    ],
  },
  worker: {
    format: "es",
  },
  define: {
    "process.env": {},
    global: "globalThis",
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  optimizeDeps: {
    include: ["@ax-code/sdk/v2"],
  },
  server: {
    port: devServerPort,
    proxy: {
      "/auth": {
        target: `http://127.0.0.1:${process.env.AX_CODE_DESKTOP_PORT || 3001}`,
        changeOrigin: true,
      },
      "/health": {
        target: `http://127.0.0.1:${process.env.AX_CODE_DESKTOP_PORT || 3001}`,
        changeOrigin: true,
      },
      "/api": {
        target: `http://127.0.0.1:${process.env.AX_CODE_DESKTOP_PORT || 3001}`,
        changeOrigin: true,
        ws: true,
      },
      // The Project/DRE Dashboard iframe loads the backend-served /dre-graph app
      // (and its /graph assets). Without these the vite SPA fallback returns
      // index.html, so the dashboard iframe recursively loads the app shell.
      "/dre-graph": {
        target: `http://127.0.0.1:${process.env.AX_CODE_DESKTOP_PORT || 3001}`,
        changeOrigin: true,
      },
      "/graph": {
        target: `http://127.0.0.1:${process.env.AX_CODE_DESKTOP_PORT || 3001}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 8000,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        miniChat: path.resolve(__dirname, "mini-chat.html"),
      },
      external: ["node:child_process", "node:fs", "node:path", "node:url"],
      onwarn(warning, warn) {
        if (isHighRiskBuildWarning(warning)) {
          throw new Error(`High-risk Desktop build warning: ${getBuildWarningMessage(warning)}`)
        }
        warn(warning)
      },
      output: {
        manualChunks(id) {
          if (id.includes("vite/preload-helper")) return "vite-preload-helper"
          const appChunkName = getAppChunkName(id)
          if (appChunkName) return appChunkName
          if (!id.includes("node_modules")) return undefined

          const packageName = getPackageNameFromNodeModuleId(id)
          if (!packageName) return undefined

          return getVendorChunkName(packageName)
        },
      },
    },
  },
})
