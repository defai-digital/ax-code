#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const desktopRoot = path.resolve(new URL('../../..', import.meta.url).pathname)

const parseArgs = (argv) => {
  const result = {
    app: process.env.AX_CODE_DESKTOP_SMOKE_APP || '',
    artifacts: process.env.AX_CODE_DESKTOP_SMOKE_ARTIFACTS || '',
    timeoutMs: Number.parseInt(process.env.AX_CODE_DESKTOP_SMOKE_TIMEOUT_MS || '45000', 10),
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--app') {
      result.app = argv[index + 1] || ''
      index += 1
    } else if (arg === '--artifacts') {
      result.artifacts = argv[index + 1] || ''
      index += 1
    } else if (arg === '--timeout-ms') {
      result.timeoutMs = Number.parseInt(argv[index + 1] || '', 10)
      index += 1
    }
  }

  return result
}

const pathExists = async (candidate) => {
  try {
    await fs.access(candidate, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

const resolveDefaultAppPath = async () => {
  const candidates = [
    path.join(desktopRoot, 'packages/electron/dist/mac-arm64/AX Code.app'),
    path.join(desktopRoot, 'packages/electron/dist/mac/AX Code.app'),
  ]
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate
  }
  return ''
}

const findMacExecutable = async (appPath) => {
  const macosDir = path.join(appPath, 'Contents', 'MacOS')
  const entries = await fs.readdir(macosDir)
  for (const entry of entries) {
    const candidate = path.join(macosDir, entry)
    const stat = await fs.stat(candidate)
    if (stat.isFile()) return candidate
  }
  throw new Error(`No executable found in ${macosDir}`)
}

const allocatePort = () => new Promise((resolve, reject) => {
  const server = http.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    const port = address && typeof address === 'object' ? address.port : 0
    server.close(() => resolve(port))
  })
})

const createStubAxCode = async (dir) => {
  const stubPath = path.join(dir, 'ax-code')
  const script = `#!/usr/bin/env node
const http = require('node:http');
const args = process.argv.slice(2);
if (args[0] !== 'serve') {
  console.error('stub ax-code only supports serve');
  process.exit(2);
}
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : (args[index + 1] || fallback);
};
const hostname = valueAfter('--hostname', '127.0.0.1');
const requestedPort = Number.parseInt(valueAfter('--port', '0'), 10) || 0;
const json = (res, body) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
};
const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/global/health' || url.pathname === '/health') {
    json(res, { healthy: true, version: '0.0.0-smoke' });
    return;
  }
  if (url.pathname === '/config') {
    json(res, {});
    return;
  }
  if (url.pathname === '/agent') {
    json(res, []);
    return;
  }
  if (url.pathname === '/find/file') {
    json(res, ['README.md']);
    return;
  }
  if (url.pathname === '/global/event' || url.pathname === '/event') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write('id: smoke-1\\n');
    res.write('data: {"type":"smoke.ready"}\\n\\n');
    setTimeout(() => res.end(), 50);
    return;
  }
  json(res, {});
});
server.listen(requestedPort, hostname, () => {
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : requestedPort;
  console.log('ax-code server listening on http://' + hostname + ':' + port);
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
`
  await fs.writeFile(stubPath, script, { mode: 0o755 })
  return stubPath
}

const fetchJson = async (url, timeoutMs = 3000) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  const body = await response.json().catch(() => null)
  return { response, body }
}

const waitFor = async (fn, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const value = await fn()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`)
}

const copyLogIfPresent = async (artifactsDir) => {
  if (!artifactsDir) return
  await fs.mkdir(artifactsDir, { recursive: true })
  const logPath = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Logs', 'AX Code Desktop', 'main.log')
    : path.join(os.homedir(), '.ax-code-desktop', 'logs', 'main.log')
  if (await pathExists(logPath)) {
    await fs.copyFile(logPath, path.join(artifactsDir, 'main.log'))
  }
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const appPath = args.app || await resolveDefaultAppPath()
  if (!appPath) {
    throw new Error('Packaged .app path not provided and default dist app was not found')
  }
  if (process.platform !== 'darwin') {
    throw new Error('smoke-packaged-app.mjs currently supports macOS .app bundles only')
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ax-code-desktop-smoke-'))
  const stubAxCode = await createStubAxCode(tmpDir)
  const serverPort = await allocatePort()
  const executable = await findMacExecutable(appPath)
  const stdout = []
  const stderr = []

  const child = spawn(executable, [], {
    env: {
      ...process.env,
      AX_CODE_BINARY: stubAxCode,
      AX_CODE_DESKTOP_ELECTRON_SERVER_PORT: String(serverPort),
      AX_CODE_DESKTOP_AX_CODE_HEALTH_TIMEOUT_MS: '1500',
      AX_CODE_DESKTOP_AX_CODE_HEALTH_INTERVAL_MS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', (chunk) => stdout.push(chunk.toString()))
  child.stderr.on('data', (chunk) => stderr.push(chunk.toString()))

  try {
    await waitFor(async () => {
      const { response, body } = await fetchJson(`http://127.0.0.1:${serverPort}/health`)
      return response.ok && (body?.axCodeRunning === true || body?.isAxCodeReady === true)
    }, args.timeoutMs, '/health readiness')

    const globalHealth = await fetchJson(`http://127.0.0.1:${serverPort}/api/global/health`)
    if (!globalHealth.response.ok || globalHealth.body?.healthy !== true) {
      throw new Error(`/api/global/health failed with status ${globalHealth.response.status}`)
    }

    const search = await fetchJson(`http://127.0.0.1:${serverPort}/api/find/file?query=README&directory=${encodeURIComponent(os.tmpdir())}&limit=1`)
    if (!search.response.ok || !Array.isArray(search.body) || search.body.length === 0) {
      throw new Error('/api/find/file smoke failed')
    }

    const streamResponse = await fetch(`http://127.0.0.1:${serverPort}/api/global/event`, {
      headers: { Accept: 'text/event-stream' },
      signal: AbortSignal.timeout(5000),
    })
    const streamText = await streamResponse.text()
    if (!streamResponse.ok || !streamText.includes('smoke.ready')) {
      throw new Error('/api/global/event stream smoke failed')
    }

    const diagnostics = await fetchJson(`http://127.0.0.1:${serverPort}/api/desktop/diagnostics/startup`)
    const eventNames = Array.isArray(diagnostics.body?.events)
      ? diagnostics.body.events.map((event) => event?.name)
      : []
    for (const required of ['electron.app.ready', 'server.utilityProcess.ready', 'ax-code.health.ready']) {
      if (!eventNames.includes(required)) {
        throw new Error(`startup diagnostics missing ${required}`)
      }
    }

    const combinedOutput = `${stdout.join('')}\n${stderr.join('')}`
    if (/Cannot find module|Module did not self-register|ERR_DLOPEN_FAILED/i.test(combinedOutput)) {
      throw new Error('packaged app emitted native module load failure')
    }

    console.log('Packaged app smoke passed')
  } catch (error) {
    if (args.artifacts) {
      await fs.mkdir(args.artifacts, { recursive: true })
      await fs.writeFile(path.join(args.artifacts, 'stdout.log'), stdout.join(''))
      await fs.writeFile(path.join(args.artifacts, 'stderr.log'), stderr.join(''))
      await copyLogIfPresent(args.artifacts)
    }
    throw error
  } finally {
    child.kill('SIGTERM')
    setTimeout(() => child.kill('SIGKILL'), 3000).unref()
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
