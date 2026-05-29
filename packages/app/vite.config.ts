import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

export default defineConfig({
  plugins: [solid()],
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
