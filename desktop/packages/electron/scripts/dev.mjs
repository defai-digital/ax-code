#!/usr/bin/env node
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const electronDir = path.resolve(__dirname, '..')
const webDir = path.resolve(electronDir, '..', 'web')
const root = path.resolve(electronDir, '..', '..')

const rendererPort = Number.parseInt(process.env.AX_CODE_DESKTOP_RENDERER_PORT || '5173', 10)
const rendererUrl = `http://127.0.0.1:${rendererPort}`

const findFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer()
  server.unref()
  server.on('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    server.close(() => {
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to allocate a local server port'))
        return
      }
      resolve(address.port)
    })
  })
})

const waitForUrl = async (url, timeoutMs = 30000) => {
  const started = Date.now()
  let lastError = null
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' })
      if (response.ok) return
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message || 'not ready'}`)
}

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    stdio: options.stdio || 'inherit',
  })
  child.on('error', reject)
  child.on('exit', (code, signal) => {
    if (code === 0) {
      resolve()
      return
    }
    reject(new Error(`${command} ${args.join(' ')} failed with ${signal || code}`))
  })
})

const spawnManaged = (children, command, args, options = {}) => {
  const child = spawn(command, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    stdio: options.stdio || 'inherit',
  })
  children.add(child)
  child.on('exit', () => children.delete(child))
  return child
}

const stopAll = (children) => {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
}

await run('node', [path.join(electronDir, 'scripts', 'bundle-main.mjs')], { cwd: electronDir })

const serverPort = Number.parseInt(process.env.AX_CODE_DESKTOP_ELECTRON_SERVER_PORT || '', 10) || await findFreePort()
const children = new Set()

const shutdown = () => {
  stopAll(children)
}
process.once('SIGINT', () => {
  shutdown()
  process.exit(130)
})
process.once('SIGTERM', () => {
  shutdown()
  process.exit(143)
})
process.once('exit', shutdown)

const sharedEnv = {
  ...process.env,
  AX_CODE_DESKTOP_PORT: String(serverPort),
  AX_CODE_DESKTOP_RENDERER_PORT: String(rendererPort),
}

const vite = spawnManaged(children, 'pnpm', ['run', 'dev:vite'], {
  cwd: webDir,
  env: sharedEnv,
})

vite.once('exit', (code, signal) => {
  if (code !== 0) {
    console.error(`[electron-dev] Vite exited with ${signal || code}`)
    stopAll(children)
    process.exit(typeof code === 'number' ? code : 1)
  }
})

await waitForUrl(rendererUrl)

const electron = spawnManaged(children, 'npx', ['electron', path.join(electronDir, 'dist', 'main.js')], {
  cwd: root,
  env: {
    ...sharedEnv,
    AX_CODE_DESKTOP_ELECTRON_RENDERER_URL: rendererUrl,
    AX_CODE_DESKTOP_ELECTRON_SERVER_PORT: String(serverPort),
  },
})

electron.on('exit', (code, signal) => {
  stopAll(children)
  process.exit(typeof code === 'number' ? code : (signal ? 1 : 0))
})
