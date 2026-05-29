import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

const appVersion = process.env.npm_package_version ?? "0.0.0"

export default defineConfig({
  plugins: [solid()],
  define: {
    "import.meta.env.VITE_AX_CODE_APP_VERSION": JSON.stringify(appVersion),
  },
  server: {
    host: "127.0.0.1",
    port: 3137,
    strictPort: false,
  },
  preview: {
    host: "127.0.0.1",
    port: 3138,
  },
  build: {
    target: "esnext",
  },
})
