import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { themeStoragePlugin } from "./vite-theme-plugin"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const nodeModulesSegment = "node_modules/"

process.noDeprecation = true

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
  plugins: [
    react({
      babel: {
        plugins: ["babel-plugin-react-compiler"],
      },
    }),
    themeStoragePlugin(),
  ],
  resolve: {
    alias: [{ find: "@", replacement: path.resolve(__dirname, "./src") }],
  },
  worker: {
    format: "es",
  },
  define: {
    "process.env": {},
    global: "globalThis",
  },
  optimizeDeps: {
    include: ["@ax-code/sdk/v2"],
  },
  build: {
    chunkSizeWarningLimit: 8000,
    rollupOptions: {
      external: ["node:child_process", "node:fs", "node:path", "node:url"],
      onwarn(warning, warn) {
        warn(warning)
      },
      output: {
        manualChunks(id) {
          if (id.includes("vite/preload-helper")) return "vite-preload-helper"
          if (!id.includes("node_modules")) return undefined

          const packageName = getPackageNameFromNodeModuleId(id)
          if (!packageName) return undefined

          return getVendorChunkName(packageName)
        },
      },
    },
  },
})
