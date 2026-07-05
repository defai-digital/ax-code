import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createStaticRoutesRuntime } from "./static-routes-runtime.js"

const createApp = () => ({
  get: vi.fn(),
  use: vi.fn(),
})

const createRuntime = ({ distDir, exists = true } = {}) => {
  const staticMiddleware = vi.fn()
  const express = {
    static: vi.fn(() => staticMiddleware),
  }
  const fs = {
    existsSync: vi.fn(() => exists),
  }
  const runtime = createStaticRoutesRuntime({
    fs,
    path,
    process: { env: { AX_CODE_DESKTOP_DIST_DIR: distDir } },
    __dirname: "/server/lib/ax-code",
    express,
  })

  return { express, fs, runtime, staticMiddleware }
}

describe("static routes runtime", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("trims the configured desktop dist directory before serving static files", () => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    const app = createApp()
    const { express, fs, runtime, staticMiddleware } = createRuntime({ distDir: " /tmp/ax-code-dist " })

    runtime.registerStaticRoutes(app)

    expect(fs.existsSync).toHaveBeenCalledWith("/tmp/ax-code-dist")
    expect(express.static).toHaveBeenCalledWith("/tmp/ax-code-dist", expect.any(Object))
    expect(app.use).toHaveBeenCalledWith(staticMiddleware)
    expect(app.get).toHaveBeenCalledOnce()
  })

  it("falls back to the bundled dist directory when the configured path is blank", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const app = createApp()
    const { express, fs, runtime } = createRuntime({ distDir: "   ", exists: false })
    const bundledDistPath = path.join("/server/lib/ax-code", "..", "dist")

    runtime.registerStaticRoutes(app)

    expect(fs.existsSync).toHaveBeenCalledWith(bundledDistPath)
    expect(express.static).not.toHaveBeenCalled()
    expect(app.use).not.toHaveBeenCalled()
    expect(app.get).toHaveBeenCalledOnce()
  })
})
