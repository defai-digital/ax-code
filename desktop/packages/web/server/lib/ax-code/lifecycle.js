import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { startHeadlessBackend, isLoopbackHostname as isSdkLoopbackHostname } from '@ax-code/sdk/headless';
import { createManagedAxCodeRuntimeAdapter } from './managed-ax-code-runtime.js';
import { evaluateAxCodeCompatibility } from './version-compat.js';

export { isSdkLoopbackHostname };

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const HEALTH_CHECK_TIMEOUT_MS = parsePositiveInt(process.env.AX_CODE_DESKTOP_AX_CODE_HEALTH_TIMEOUT_MS, 5000);
const HEALTH_CHECK_MAX_CONSECUTIVE_FAILURES = parsePositiveInt(
  process.env.AX_CODE_DESKTOP_AX_CODE_HEALTH_CONSECUTIVE_FAILURES,
  20
);
const HEALTH_CHECK_INTERVAL_OVERRIDE_MS = parsePositiveInt(process.env.AX_CODE_DESKTOP_AX_CODE_HEALTH_INTERVAL_MS, 0);
const HEALTH_CHECK_RESULT_CACHE_MS = parsePositiveInt(process.env.AX_CODE_DESKTOP_AX_CODE_HEALTH_CACHE_MS, 750);

export const createAxCodeLifecycleRuntime = (deps) => {
  const {
    state,
    env,
    syncToHmrState,
    syncFromHmrState,
    getAxCodeAuthHeaders,
    buildAxCodeUrl,
    waitForReady,
    normalizeApiPrefix,
    applyAxCodeBinaryFromSettings,
    ensureAxCodeCliEnv,
    ensureLocalAxCodeServerPassword,
    buildWslExecArgs,
    resolveWslExecutablePath,
    resolveManagedAxCodeLaunchSpec,
    setAxCodePort,
    setDetectedAxCodeApiPrefix,
    setupProxy,
    ensureAxCodeApiPrefix,
    clearResolvedAxCodeBinary,
    buildAugmentedPath,
    buildManagedAxCodePath,
    getManagedAxCodeShellEnvSnapshot,
    getActiveSessionCount = () => 0,
    recordStartupEvent = null,
  } = deps;

  const markStartup = (name, details = {}, options = {}) => {
    if (typeof recordStartupEvent !== 'function') return null;
    return recordStartupEvent(name, details, options);
  };

  const portReadyCallbacks = [];
  let startupAbortController = null;

  const setAxCodePortInternal = (port) => {
    setAxCodePort(port);
    if (port > 0 && portReadyCallbacks.length > 0) {
      const cbs = portReadyCallbacks.splice(0);
      for (const cb of cbs) cb(port);
    }
  };

  const killProcessOnPort = (port) => {
    if (!port || process.platform === 'win32') return;
    try {
      const result = spawnSync('lsof', ['-ti', `:${port}`], { encoding: 'utf8', timeout: 5000, windowsHide: true });
      const output = result.stdout || '';
      const myPid = process.pid;
      for (const pidStr of output.split(/\s+/)) {
        const pid = parseInt(pidStr.trim(), 10);
        if (pid && pid !== myPid) {
          try {
            spawnSync('kill', ['-9', String(pid)], { stdio: 'ignore', timeout: 2000 });
          } catch {
          }
        }
      }
    } catch {
    }
  };

  const hasChildProcessExited = (child) => !child || child.exitCode !== null || child.signalCode !== null;

  const isManagedAxCodeProcessAlive = () => {
    const child = state.axCodeProcess;
    if (!child || hasChildProcessExited(child)) return false;
    if (!child.pid) return true;
    try {
      process.kill(child.pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  const waitForChildProcessClose = (child, timeoutMs) => new Promise((resolve) => {
    if (!child || hasChildProcessExited(child)) {
      resolve(true);
      return;
    }

    let done = false;
    const finish = (closed) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.off('close', onClose);
      child.off('error', onError);
      resolve(closed);
    };

    const onClose = () => finish(true);
    const onError = () => finish(hasChildProcessExited(child));
    const timer = setTimeout(() => finish(hasChildProcessExited(child)), timeoutMs);

    child.once('close', onClose);
    child.once('error', onError);
  });

  const waitForPortRelease = (port, timeoutMs, hostname = env.ENV_CONFIGURED_AX_CODE_HOSTNAME) => {
    if (!port) {
      return Promise.resolve(true);
    }

    const probeHost = !hostname || hostname === '0.0.0.0' || hostname === '::' || hostname === '[::]'
      ? '127.0.0.1'
      : hostname;
    const deadline = Date.now() + timeoutMs;

    return new Promise((resolve) => {
      const attempt = () => {
        const socket = net.connect({ port, host: probeHost });
        let settled = false;

        const finish = (released) => {
          if (settled) return;
          settled = true;
          socket.removeAllListeners();
          socket.destroy();
          if (released || Date.now() >= deadline) {
            resolve(released);
            return;
          }
          setTimeout(attempt, 50);
        };

        socket.once('connect', () => finish(false));
        socket.once('timeout', () => finish(true));
        socket.once('error', (error) => {
          if (error && typeof error === 'object' && (error.code === 'ECONNREFUSED' || error.code === 'EHOSTUNREACH')) {
            finish(true);
            return;
          }
          finish(false);
        });
        socket.setTimeout(100);
      };

      attempt();
    });
  };

  const closeManagedAxCodeChild = async (child) => {
    if (!child) {
      return;
    }

    const pid = child.pid;
    if (!pid || hasChildProcessExited(child)) {
      await waitForChildProcessClose(child, 250);
      return;
    }

    if (process.platform === 'win32') {
      try {
        child.kill();
      } catch {
      }

      if (await waitForChildProcessClose(child, 800)) {
        return;
      }

      try {
        spawnSync('taskkill', ['/pid', String(pid), '/t'], {
          stdio: 'ignore',
          timeout: 3000,
          windowsHide: true,
        });
      } catch {
      }

      if (await waitForChildProcessClose(child, 1500)) {
        return;
      }

      try {
        spawnSync('taskkill', ['/pid', String(pid), '/f', '/t'], {
          stdio: 'ignore',
          timeout: 5000,
          windowsHide: true,
        });
      } catch {
      }

      await waitForChildProcessClose(child, 3000);
      return;
    }

    try {
      child.kill('SIGTERM');
    } catch {
    }

    if (await waitForChildProcessClose(child, 2500)) {
      return;
    }

    try {
      child.kill('SIGKILL');
    } catch {
    }

    await waitForChildProcessClose(child, 1000);
  };

  const formatCapturedOutput = ({ stdout, stderr }) => {
    const parts = [];
    if (stdout.trim()) {
      parts.push(`stdout:\n${stdout.trim()}`);
    }
    if (stderr.trim()) {
      parts.push(`stderr:\n${stderr.trim()}`);
    }
    return parts.length > 0 ? parts.join('\n\n') : 'No stdout/stderr captured';
  };

  const createManagedAxCodeServerProcessLegacy = async ({ hostname, port, timeout, cwd, env: processEnv, binary, args }) => {
    state.lastAxCodeLaunchDiagnostics = {
      ...state.lastAxCodeLaunchDiagnostics,
      via: 'legacy-spawn',
    };

    const child = spawn(binary, args, {
      cwd,
      env: processEnv,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const url = await new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let done = false;
      const finish = (handler, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        child.stdout?.off('data', onStdout);
        child.stderr?.off('data', onStderr);
        child.off('exit', onExit);
        child.off('error', onError);
        handler(value);
      };

      const onStdout = (chunk) => {
        stdout += chunk.toString();
        // Only parse newline-terminated lines. The trailing segment may be an
        // incomplete chunk (the ready line can arrive split across stdout reads);
        // matching it would resolve a truncated URL and yield the wrong port.
        const lastNewline = stdout.lastIndexOf('\n');
        if (lastNewline === -1) return;
        const lines = stdout.slice(0, lastNewline).split('\n');
        for (const line of lines) {
          if (!line.startsWith('ax-code server listening')) continue;
          const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
          if (!match) {
            finish(reject, new Error(`Failed to parse server url from output: ${line}`));
            return;
          }
          finish(resolve, match[1]);
          return;
        }
      };

      const onStderr = (chunk) => {
        stderr += chunk.toString();
      };

      const onExit = (code, signal) => {
        const reason = signal ? `signal ${signal}` : `code ${code}`;
        const appBundleHint = process.platform === 'darwin' && /\/AX Code\.app\/Contents\/MacOS\/(?:AX Code|ax-code)$/i.test(binary)
          ? ' The configured binary appears to point at the macOS desktop app bundle; AX Code Desktop needs the standalone ax-code CLI.'
          : '';
        finish(reject, new Error(`AX Code process exited before serving with ${reason}. Binary used: ${binary}.${appBundleHint} ${formatCapturedOutput({ stdout, stderr })}`));
      };

      const onError = (error) => {
        finish(reject, error);
      };

      const timer = setTimeout(() => {
        // On timeout the caller never receives a handle to close(), so kill the
        // spawned child here to avoid orphaning a still-running ax-code process
        // (which typically still holds the port). startAxCode retries, so leaving
        // it alive would compound a leak across attempts.
        void closeManagedAxCodeChild(child);
        finish(reject, new Error(`Timeout waiting for ax-code to start after ${timeout}ms`));
      }, timeout);

      child.stdout?.on('data', onStdout);
      child.stderr?.on('data', onStderr);
      child.on('exit', onExit);
      child.on('error', onError);
    });

    return {
      url,
      async close() {
        await closeManagedAxCodeChild(child);
      },
    };
  };

  const createManagedAxCodeServerProcess = async ({ hostname, port, timeout, cwd, env: processEnv, shellEnvKeysCount = 0, signal }) => {
    let binary = (process.env.AX_CODE_BINARY || 'ax-code').trim() || 'ax-code';
    let args = ['serve', '--hostname', hostname, '--port', String(port ?? 0)];
    let launchWrapperType = null;
    const pathSep = process.platform === 'win32' ? ';' : ':';

    // Windows/WSL: use legacy spawn path
    if (process.platform === 'win32') {
      if (state.useWslForAxCode) {
        const wslBinary = state.resolvedWslBinary || resolveWslExecutablePath();
        if (!wslBinary) {
          throw new Error('WSL executable not found while attempting to launch ax-code from WSL');
        }
        const wslAxCode = state.resolvedWslAxCodePath?.trim() || 'ax-code';
        const serveHost = hostname === '127.0.0.1' ? '0.0.0.0' : hostname;
        binary = wslBinary;
        args = buildWslExecArgs([wslAxCode, 'serve', '--hostname', serveHost, '--port', String(port ?? 0)], state.resolvedWslDistro);
      } else {
        const launchSpec = resolveManagedAxCodeLaunchSpec(binary);
        if (launchSpec?.binary) {
          if (launchSpec.wrapperType) {
            console.log(`Launching ax-code via ${launchSpec.wrapperType}: ${launchSpec.binary}`);
          }
          launchWrapperType = launchSpec.wrapperType || null;
          binary = launchSpec.binary;
          args = [...(Array.isArray(launchSpec.args) ? launchSpec.args : []), ...args];
        }
      }

      const pathValue = typeof processEnv?.PATH === 'string' ? processEnv.PATH : '';
      const pathEntryCount = pathValue ? pathValue.split(pathSep).filter(Boolean).length : 0;
      state.lastAxCodeLaunchDiagnostics = {
        launchedAt: new Date().toISOString(),
        binary, args, cwd, hostname, port,
        wrapperType: launchWrapperType, pathEntryCount,
        hasShellEnv: shellEnvKeysCount > 0, shellEnvKeysCount,
        via: 'legacy-spawn',
      };
      console.log('[AX Code] Launching managed server (Windows)', state.lastAxCodeLaunchDiagnostics);
      markStartup('ax-code.process.launched', {
        via: 'legacy-spawn',
        platform: 'win32',
        hostname,
        port: port || 'auto',
        wrapperType: launchWrapperType,
      }, { source: 'web-server', milestone: 'ax-code.process.launched' });
      return createManagedAxCodeServerProcessLegacy({ hostname, port, timeout, cwd, env: processEnv, binary, args });
    }

    // macOS/Linux: use the SDK-owned headless launcher for all managed CLI
    // shapes. The workspace SDK accepts explicit binary/args, so wrapper
    // launches and custom binary names still get SDK readiness/auth/shutdown
    // behavior instead of the older stdout-parsing spawn path.
    const launchSpec = resolveManagedAxCodeLaunchSpec(binary);
    if (launchSpec?.binary) {
      launchWrapperType = launchSpec.wrapperType || null;
      binary = launchSpec.binary;
      args = [...(Array.isArray(launchSpec.args) ? launchSpec.args : []), ...args];
    }

    const envPath = typeof processEnv?.PATH === 'string' ? processEnv.PATH : (process.env.PATH || '');
    const password = processEnv?.AX_CODE_SERVER_PASSWORD;
    const pathEntryCount = envPath ? envPath.split(pathSep).filter(Boolean).length : 0;
    state.lastAxCodeLaunchDiagnostics = {
      launchedAt: new Date().toISOString(),
      binary, args, cwd, hostname, port,
      wrapperType: launchWrapperType, pathEntryCount,
      hasShellEnv: shellEnvKeysCount > 0, shellEnvKeysCount,
      via: 'sdk-headless',
    };
    console.log('[AX Code] Launching managed server via SDK', state.lastAxCodeLaunchDiagnostics);
    markStartup('ax-code.process.launched', {
      via: 'sdk-headless',
      hostname,
      port: port || 'auto',
      wrapperType: launchWrapperType,
    }, { source: 'web-server', milestone: 'ax-code.process.launched' });

    // Strip AX_CODE_SERVER_PASSWORD from the env spread — the SDK sets it from
    // auth.password, so passing it twice is confusing and redundant.
    const { AX_CODE_SERVER_PASSWORD: _pass, ...sdkEnv } = processEnv ?? {};

    let handle;
    try {
      handle = await startHeadlessBackend({
        directory: cwd,
        hostname,
        port: port > 0 ? port : undefined,
        binary,
        args,
        timeout,
        auth: { username: 'ax-code', password },
        allowNetworkBind: !isSdkLoopbackHostname(hostname),
        signal,
        env: {
          ...sdkEnv,
          PATH: envPath,
        },
        onStdout: (line) => console.log(`[ax-code] ${line}`),
        onStderr: (line) => console.error(`[ax-code stderr] ${line}`),
      });
    } catch (error) {
      if (error?.diagnostics) {
        state.lastAxCodeLaunchDiagnostics = {
          ...state.lastAxCodeLaunchDiagnostics,
          sdk: summarizeSdkLaunchDiagnostics(error.diagnostics, { includeCapturedOutput: true }),
        };
      }
      throw error;
    }

    state.lastAxCodeLaunchDiagnostics = {
      ...state.lastAxCodeLaunchDiagnostics,
      sdk: summarizeSdkLaunchDiagnostics(handle.diagnostics),
    };

    // The SDK handle is not a ChildProcess; without exit fields,
    // hasChildProcessExited() would treat it as dead (undefined !== null) and
    // every health blip would trigger a restart. Track real exit state via the
    // handle's `closed` promise instead of pinning the fields to null forever.
    const managed = { ...handle, healthVerified: true, exitCode: null, signalCode: null };
    if (typeof handle.closed?.then === 'function') {
      void handle.closed.then(() => {
        if (managed.exitCode === null && managed.signalCode === null) {
          const exit = handle.diagnostics?.exit ?? null;
          managed.signalCode = exit?.signal ?? null;
          managed.exitCode = exit?.code ?? (managed.signalCode === null ? 0 : null);
        }
      });
    }
    return managed;
  };

  const summarizeSdkLaunchDiagnostics = (diagnostics, { includeCapturedOutput = false } = {}) => {
    if (!diagnostics || typeof diagnostics !== 'object') {
      return null;
    }
    return {
      launchedAt: diagnostics.launchedAt ?? null,
      binary: diagnostics.binary ?? null,
      args: Array.isArray(diagnostics.args) ? [...diagnostics.args] : [],
      hostname: diagnostics.hostname ?? null,
      port: diagnostics.port ?? null,
      readyUrl: diagnostics.readyUrl ?? null,
      health: diagnostics.health
        ? { ok: diagnostics.health.ok, status: diagnostics.health.status, error: diagnostics.health.error ?? null }
        : null,
      exit: diagnostics.exit ?? null,
      envKeyCount: Array.isArray(diagnostics.envKeys) ? diagnostics.envKeys.length : null,
      ...(includeCapturedOutput && typeof diagnostics.capturedOutput === 'string'
        ? { capturedOutput: diagnostics.capturedOutput.slice(-2000) }
        : {}),
    };
  };

  // Newer runtimes (>= 5.12.3) report structured readiness on /global/health:
  // readiness { processAlive, apiReady, providersReady, indexReady },
  // startup { startedAt, uptimeMs, checkedAt }, runtime.taskSummary.
  // Capture them so the desktop can show "runtime ready, providers warming"
  // instead of a bare HTTP-ok. Older runtimes simply leave this null.
  const recordAxCodeRuntimeHealth = (body) => {
    if (!body || typeof body !== 'object') {
      return;
    }
    const readiness = body.readiness && typeof body.readiness === 'object' ? body.readiness : null;
    const startup = body.startup && typeof body.startup === 'object' ? body.startup : null;
    const taskSummary = body.runtime?.taskSummary && typeof body.runtime.taskSummary === 'object'
      ? body.runtime.taskSummary
      : null;
    state.axCodeRuntimeHealth = (readiness || startup || taskSummary)
      ? { checkedAt: new Date().toISOString(), readiness, startup, taskSummary }
      : null;
  };

  let warnedIncompatibleVersion = null;
  const recordDetectedAxCodeVersion = (rawVersion) => {
    const compatibility = evaluateAxCodeCompatibility(rawVersion);
    state.detectedAxCodeVersion = compatibility.version;
    state.axCodeVersionCompatibility = compatibility;
    if (compatibility.compatible === false && warnedIncompatibleVersion !== compatibility.version) {
      warnedIncompatibleVersion = compatibility.version;
      console.warn(
        `[AX Code] Installed ax-code runtime ${compatibility.version} is older than the minimum supported ` +
        `${compatibility.minSupportedVersion}. Some features may not work — upgrade the ax-code CLI.`
      );
    }
  };

  const isAxCodeProcessHealthy = async () => {
    if (!state.axCodeProcess || !state.axCodePort) {
      return false;
    }

    try {
      const response = await fetch(buildAxCodeUrl('/global/health', ''), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...getAxCodeAuthHeaders(),
        },
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });
      if (!response.ok) {
        response.body?.cancel();
        return false;
      }
      const body = await response.json().catch(() => null);
      if (typeof body?.version === 'string') {
        recordDetectedAxCodeVersion(body.version);
      }
      recordAxCodeRuntimeHealth(body);
      return body?.healthy === true;
    } catch {
      return false;
    }
  };

  const probeExternalAxCode = async (port, origin) => {
    if (!port || port <= 0) {
      return false;
    }

    try {
      const base = origin ?? `http://127.0.0.1:${port}`;
      const response = await fetch(`${base}/global/health`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...getAxCodeAuthHeaders(),
        },
        signal: AbortSignal.timeout(1000),
      });
      if (!response.ok) {
        response.body?.cancel();
        return false;
      }
      const body = await response.json().catch(() => null);
      if (typeof body?.version === 'string') {
        recordDetectedAxCodeVersion(body.version);
      }
      recordAxCodeRuntimeHealth(body);
      return body?.healthy === true;
    } catch {
      return false;
    }
  };

  const waitForAxCodePort = (timeoutMs = 15000) => {
    if (state.axCodePort !== null) {
      return Promise.resolve(state.axCodePort);
    }

    return new Promise((resolve, reject) => {
      let done = false;
      const onPort = (port) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(port);
      };
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        const i = portReadyCallbacks.indexOf(onPort);
        if (i !== -1) portReadyCallbacks.splice(i, 1);
        reject(new Error('Timed out waiting for ax-code port'));
      }, timeoutMs);
      portReadyCallbacks.push(onPort);
    });
  };

  const START_AX_CODE_MAX_ATTEMPTS = 2;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const managedAxCodeRuntime = createManagedAxCodeRuntimeAdapter({
    launchServerProcess: createManagedAxCodeServerProcess,
    probeProcessHealth: isAxCodeProcessHealthy,
    probeExternalServer: probeExternalAxCode,
    killPort: killProcessOnPort,
    waitForPortRelease,
    isProcessAlive: isManagedAxCodeProcessAlive,
  });

  const startAxCodeOnce = async () => {
    const currentAbortController = new AbortController();
    startupAbortController = currentAbortController;

    const requestedPort = env.ENV_CONFIGURED_AX_CODE_PORT ?? null;
    console.log(`Starting AX Code${requestedPort ? ` on port ${requestedPort}` : ' (OS-assigned port)'}...`);

    await applyAxCodeBinaryFromSettings({ strict: true });
    ensureAxCodeCliEnv();
    const axCodePassword = await ensureLocalAxCodeServerPassword({ rotateManaged: true });
    const envPath = typeof buildManagedAxCodePath === 'function'
      ? buildManagedAxCodePath()
      : typeof buildAugmentedPath === 'function'
        ? buildAugmentedPath()
      : process.env.PATH;
    const shellEnv = typeof getManagedAxCodeShellEnvSnapshot === 'function'
      ? getManagedAxCodeShellEnvSnapshot() || {}
      : {};

    try {
      const serverInstance = await managedAxCodeRuntime.launchServerProcess({
        hostname: env.ENV_CONFIGURED_AX_CODE_HOSTNAME,
        port: requestedPort,
        timeout: 30000,
        cwd: state.axCodeWorkingDirectory,
        shellEnvKeysCount: Object.keys(shellEnv).length,
        signal: currentAbortController.signal,
        env: {
          ...shellEnv,
          ...process.env,
          PATH: envPath,
          AX_CODE_SERVER_PASSWORD: axCodePassword,
        },
      });

      if (!serverInstance || !serverInstance.url) {
        throw new Error('AX Code server started but URL is missing');
      }

      const url = new URL(serverInstance.url);
      const port = parseInt(url.port, 10);
      const prefix = normalizeApiPrefix(url.pathname);

      // SDK path: startHeadlessBackend already ran a health check before resolving,
      // so waitForReady is redundant — trust the handle and proceed immediately.
      if (serverInstance.healthVerified || await waitForReady(serverInstance.url, 10000)) {
        setAxCodePortInternal(port);
        setDetectedAxCodeApiPrefix(prefix);

        state.isAxCodeReady = true;
        state.lastAxCodeError = null;
        state.axCodeNotReadySince = 0;
        markStartup('ax-code.health.ready', {
          port,
          apiPrefix: prefix,
          via: serverInstance.healthVerified ? 'sdk-headless' : 'legacy-health-check',
        }, { source: 'web-server', milestone: 'ax-code.health.ready' });

        return serverInstance;
      }

      try {
        await serverInstance.close();
      } catch {
      }
      throw new Error('AX Code server started but health check timed out (timeout)');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.lastAxCodeError = message;
      state.axCodePort = null;
      syncToHmrState();
      console.error(`Failed to start AX Code: ${message}`);
      throw error;
    } finally {
      if (startupAbortController === currentAbortController) {
        startupAbortController = null;
      }
    }
  };

  const startAxCode = async () => {
    let lastError = null;
    for (let attempt = 1; attempt <= START_AX_CODE_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await startAxCodeOnce();
      } catch (error) {
        lastError = error;
        if (error?.code === 'AX_CODE_BINARY_INVALID') {
          break;
        }
        if (state.isShuttingDown) {
          break;
        }
        if (attempt >= START_AX_CODE_MAX_ATTEMPTS) {
          break;
        }

        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[AX Code] Managed server startup failed on attempt ${attempt}/${START_AX_CODE_MAX_ATTEMPTS}; retrying: ${message}`);
        state.axCodePort = null;
        state.isAxCodeReady = false;
        state.axCodeNotReadySince = Date.now();
        syncToHmrState();
        await delay(750 * attempt);
      }
    }

    throw lastError;
  };

  const restartAxCode = async () => {
    if (state.isShuttingDown) return;
    if (state.currentRestartPromise) {
      await state.currentRestartPromise;
      return;
    }

    state.currentRestartPromise = (async () => {
      state.isRestartingAxCode = true;
      state.isAxCodeReady = false;
      state.axCodeNotReadySince = Date.now();
      lastHealthProbeResult = null;
      console.log('Restarting ax-code process...');

      if (state.isExternalAxCode) {
        console.log('Re-probing external ax-code server...');
        const probePort = state.axCodePort || env.ENV_CONFIGURED_AX_CODE_PORT || 4096;
        const probeOrigin = state.axCodeBaseUrl ?? env.ENV_CONFIGURED_AX_CODE_HOST?.origin;
        const healthy = await managedAxCodeRuntime.probeExternalServer(probePort, probeOrigin);
        if (healthy) {
          console.log(`External ax-code server on port ${probePort} is healthy`);
          setAxCodePortInternal(probePort);
          state.isAxCodeReady = true;
          state.lastAxCodeError = null;
          state.axCodeNotReadySince = 0;
          markStartup('ax-code.health.ready', {
            port: probePort,
            via: 'external',
          }, { source: 'web-server', milestone: 'ax-code.health.ready' });
          syncToHmrState();
        } else {
          state.lastAxCodeError = `External ax-code server on port ${probePort} is not responding`;
          console.error(state.lastAxCodeError);
          throw new Error(state.lastAxCodeError);
        }

        if (state.expressApp) {
          setupProxy(state.expressApp);
          ensureAxCodeApiPrefix();
        }
        return;
      }

      const portToKill = state.axCodePort;

      if (state.axCodeProcess) {
        console.log('Stopping existing ax-code process...');
        try {
          await state.axCodeProcess.close();
        } catch (error) {
          console.warn('Error closing ax-code process:', error);
        }
        state.axCodeProcess = null;
        syncToHmrState();
      }

      if (!(await managedAxCodeRuntime.releasePort(portToKill, 5000))) {
        console.warn(`Timed out waiting for ax-code port ${portToKill} to be released`);
      }

      if (env.ENV_CONFIGURED_AX_CODE_PORT) {
        console.log(`Using AX Code port from environment: ${env.ENV_CONFIGURED_AX_CODE_PORT}`);
        setAxCodePortInternal(env.ENV_CONFIGURED_AX_CODE_PORT);
      } else {
        state.axCodePort = null;
        syncToHmrState();
      }

      state.axCodeApiPrefixDetected = true;
      state.axCodeApiPrefix = '';
      if (state.axCodeApiDetectionTimer) {
        clearTimeout(state.axCodeApiDetectionTimer);
        state.axCodeApiDetectionTimer = null;
      }

      state.lastAxCodeError = null;
      state.axCodeProcess = await startAxCode();
      syncToHmrState();

      if (state.expressApp) {
        setupProxy(state.expressApp);
        ensureAxCodeApiPrefix();
      }
    })();

    try {
      await state.currentRestartPromise;
    } catch (error) {
      console.error(`Failed to restart ax-code: ${error.message}`);
      state.lastAxCodeError = error.message;
      if (!env.ENV_CONFIGURED_AX_CODE_PORT) {
        state.axCodePort = null;
        syncToHmrState();
      }
      state.axCodeApiPrefixDetected = true;
      state.axCodeApiPrefix = '';
      throw error;
    } finally {
      state.currentRestartPromise = null;
      state.isRestartingAxCode = false;
    }
  };

  const waitForAxCodeReady = async (timeoutMs = 20000, intervalMs = 400) => {
    if (!state.axCodePort) {
      throw new Error('AX Code port is not available');
    }

    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    let backoff = 50;

    while (Date.now() < deadline) {
      try {
        const [configResult, agentResult] = await Promise.all([
          fetch(buildAxCodeUrl('/config', ''), {
            method: 'GET',
            headers: { Accept: 'application/json', ...getAxCodeAuthHeaders() },
            signal: AbortSignal.timeout(5000),
          }).catch((error) => error),
          fetch(buildAxCodeUrl('/agent', ''), {
            method: 'GET',
            headers: { Accept: 'application/json', ...getAxCodeAuthHeaders() },
            signal: AbortSignal.timeout(5000),
          }).catch((error) => error),
        ]);

        if (configResult instanceof Error) {
          if (!(agentResult instanceof Error)) agentResult.body?.cancel();
          lastError = configResult;
        } else if (!configResult.ok) {
          configResult.body?.cancel();
          if (!(agentResult instanceof Error)) agentResult.body?.cancel();
          lastError = new Error(`ax-code config endpoint responded with status ${configResult.status}`);
        } else if (agentResult instanceof Error) {
          configResult.body?.cancel();
          lastError = agentResult;
        } else if (!agentResult.ok) {
          configResult.body?.cancel();
          agentResult.body?.cancel();
          lastError = new Error(`Agent endpoint responded with status ${agentResult.status}`);
        } else {
          configResult.body?.cancel();
          agentResult.body?.cancel();
          state.isAxCodeReady = true;
          state.lastAxCodeError = null;
          return;
        }
      } catch (error) {
        lastError = error;
      }

      await new Promise((resolve) => setTimeout(resolve, Math.min(backoff, intervalMs)));
      backoff = Math.min(backoff * 2, intervalMs);
    }

    if (lastError) {
      state.lastAxCodeError = lastError.message || String(lastError);
      throw lastError;
    }

    const timeoutError = new Error('Timed out waiting for ax-code to become ready');
    state.lastAxCodeError = timeoutError.message;
    throw timeoutError;
  };

  const waitForAgentPresence = async (agentName, timeoutMs = 15000, intervalMs = 300) => {
    if (!state.axCodePort) {
      throw new Error('AX Code port is not available');
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(buildAxCodeUrl('/agent'), {
          method: 'GET',
          headers: { Accept: 'application/json', ...getAxCodeAuthHeaders() },
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          const agents = await response.json();
          if (Array.isArray(agents) && agents.some((agent) => agent?.name === agentName)) {
            return;
          }
        } else {
          response.body?.cancel();
        }
      } catch {
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Agent "${agentName}" not available after ax-code restart`);
  };

  const refreshAxCodeAfterConfigChange = async (reason, options = {}) => {
    const { agentName, readyTimeoutMs } = options;
    const effectiveReadyTimeoutMs = Number.isFinite(readyTimeoutMs) && readyTimeoutMs > 0
      ? readyTimeoutMs
      : undefined;

    console.log(`Refreshing ax-code after ${reason}`);
    clearResolvedAxCodeBinary();
    await applyAxCodeBinaryFromSettings();

    await restartAxCode();

    try {
      await waitForAxCodeReady(effectiveReadyTimeoutMs);
      state.isAxCodeReady = true;
      state.axCodeNotReadySince = 0;

      if (agentName) {
        await waitForAgentPresence(agentName);
      }

      state.isAxCodeReady = true;
      state.axCodeNotReadySince = 0;
    } catch (error) {
      state.isAxCodeReady = false;
      state.axCodeNotReadySince = Date.now();
      console.error(`Failed to refresh ax-code after ${reason}:`, error.message);
      throw error;
    }
  };

  const bootstrapAxCodeAtStartup = async () => {
    try {
      syncFromHmrState();

      // Run health probes in parallel to avoid serial waterfall delays.
      // probeProcessHealth checks a previously-managed process (HMR transfer),
      // probeExternalServer checks for an already-running external server.
      const skipStart = Boolean(env.ENV_SKIP_AX_CODE_START && env.ENV_EFFECTIVE_PORT);
      const externalProbePort = env.ENV_EFFECTIVE_PORT || 4096;
      const externalProbeOrigin = env.ENV_EFFECTIVE_PORT
        ? env.ENV_CONFIGURED_AX_CODE_HOST?.origin
        : undefined;
      const shouldProbeExternal = !skipStart;

      const [processHealthy, externalHealthy] = await Promise.all([
        managedAxCodeRuntime.probeProcessHealth().catch(() => false),
        shouldProbeExternal
          ? managedAxCodeRuntime.probeExternalServer(externalProbePort, externalProbeOrigin).catch(() => false)
          : Promise.resolve(false),
      ]);

      if (processHealthy) {
        console.log(`[HMR] Reusing existing AX Code process on port ${state.axCodePort}`);
        markStartup('ax-code.health.ready', {
          port: state.axCodePort,
          via: 'hmr-reuse',
        }, { source: 'web-server', milestone: 'ax-code.health.ready' });
      } else if (skipStart) {
        const label = env.ENV_CONFIGURED_AX_CODE_HOST ? env.ENV_CONFIGURED_AX_CODE_HOST.origin : `http://localhost:${env.ENV_EFFECTIVE_PORT}`;
        console.log(`Using external AX Code server at ${label} (skip-start mode)`);
        state.axCodeBaseUrl = env.ENV_CONFIGURED_AX_CODE_HOST?.origin ?? null;
        setAxCodePortInternal(env.ENV_EFFECTIVE_PORT);
        state.isAxCodeReady = true;
        state.isExternalAxCode = true;
        state.lastAxCodeError = null;
        state.axCodeNotReadySince = 0;
        markStartup('ax-code.health.ready', {
          port: env.ENV_EFFECTIVE_PORT,
          via: 'external-skip-start',
        }, { source: 'web-server', milestone: 'ax-code.health.ready' });
        syncToHmrState();
      } else if (externalHealthy) {
        if (env.ENV_EFFECTIVE_PORT) {
          const label = env.ENV_CONFIGURED_AX_CODE_HOST ? env.ENV_CONFIGURED_AX_CODE_HOST.origin : `http://localhost:${env.ENV_EFFECTIVE_PORT}`;
          console.log(`Auto-detected existing AX Code server at ${label}`);
          state.axCodeBaseUrl = env.ENV_CONFIGURED_AX_CODE_HOST?.origin ?? null;
          setAxCodePortInternal(env.ENV_EFFECTIVE_PORT);
        } else {
          console.log('Auto-detected existing AX Code server on default port 4096');
          setAxCodePortInternal(4096);
        }
        state.isAxCodeReady = true;
        state.isExternalAxCode = true;
        state.lastAxCodeError = null;
        state.axCodeNotReadySince = 0;
        markStartup('ax-code.health.ready', {
          port: env.ENV_EFFECTIVE_PORT || 4096,
          via: env.ENV_EFFECTIVE_PORT ? 'external-auto-detected' : 'external-default-port',
        }, { source: 'web-server', milestone: 'ax-code.health.ready' });
        syncToHmrState();
      } else {
        if (env.ENV_EFFECTIVE_PORT) {
          console.log(`Using AX Code port from environment: ${env.ENV_EFFECTIVE_PORT}`);
          setAxCodePortInternal(env.ENV_EFFECTIVE_PORT);
        } else {
          state.axCodePort = null;
          syncToHmrState();
        }

        state.lastAxCodeError = null;
        state.axCodeProcess = await startAxCode();
        syncToHmrState();
      }
      await waitForAxCodePort();
      try {
        await waitForAxCodeReady();
      } catch (error) {
        console.error(`AX Code readiness check failed: ${error.message}`);
      }
    } catch (error) {
      console.error(`Failed to start AX Code: ${error.message}`);
      console.log('Continuing without AX Code integration...');
      state.lastAxCodeError = error.message;
    }
  };

  /**
   * Perform an immediate (one-shot) health check and restart ax-code if it's
   * not healthy.  Callers on the SSE / WS proxy path use this to trigger
   * recovery without waiting for the next periodic interval (up to 15 s).
   *
   * Skips restart when sessions are actively busy — a busy server under
   * concurrent load can fail the health check timeout without actually
   * being dead (the health endpoint competes with LLM work).
   * Forces restart if sessions stay "busy" and the server stays unhealthy
   * for over 2 minutes (staleness guard against stuck session state).
   */
  const STALE_BUSY_GRACE_MS = 2 * 60 * 1000;
  let lastUnhealthyWithBusySessionsAt = 0;
  let consecutiveHealthFailures = 0;
  let healthProbePromise = null;
  let healthCheckCyclePromise = null;
  let lastHealthProbeResult = null;

  const resetHealthFailureState = () => {
    consecutiveHealthFailures = 0;
    lastUnhealthyWithBusySessionsAt = 0;
  };

  const probeAxCodeHealth = async () => {
    const now = Date.now();
    if (lastHealthProbeResult && now - lastHealthProbeResult.at < HEALTH_CHECK_RESULT_CACHE_MS) {
      return lastHealthProbeResult.healthy;
    }

    if (healthProbePromise) {
      return healthProbePromise;
    }

    healthProbePromise = managedAxCodeRuntime.probeProcessHealth()
      .then((healthy) => {
        lastHealthProbeResult = { at: Date.now(), healthy };
        return healthy;
      })
      .finally(() => {
        healthProbePromise = null;
      });

    return healthProbePromise;
  };

  const shouldSkipRestartForBusySessions = () => {
    const activeCount = getActiveSessionCount();
    if (activeCount === 0) {
      lastUnhealthyWithBusySessionsAt = 0;
      return false;
    }

    const now = Date.now();
    if (!lastUnhealthyWithBusySessionsAt) {
      lastUnhealthyWithBusySessionsAt = now;
      return true;
    }

    if (now - lastUnhealthyWithBusySessionsAt >= STALE_BUSY_GRACE_MS) {
      console.warn(
        `[lifecycle] ax-code unhealthy with ${activeCount} busy session(s) for > 2 min — forcing restart`
      );
      lastUnhealthyWithBusySessionsAt = 0;
      return false;
    }

    return true;
  };

  const runHealthCheckCycle = async (source) => {
    if (!state.axCodeProcess || state.isShuttingDown || state.isRestartingAxCode) return;
    if (healthCheckCyclePromise) return healthCheckCyclePromise;

    healthCheckCyclePromise = (async () => {
      const healthy = await probeAxCodeHealth();
      if (!healthy) {
        if (!managedAxCodeRuntime.isProcessAlive()) {
          console.log(`[lifecycle] ${source} health check: ax-code process exited, restarting...`);
          consecutiveHealthFailures = 0;
          lastHealthProbeResult = null;
          await restartAxCode();
          return;
        }
        consecutiveHealthFailures += 1;
        console.warn(
          `[lifecycle] ${source} health check failed (${consecutiveHealthFailures}/${HEALTH_CHECK_MAX_CONSECUTIVE_FAILURES})`
        );
        if (consecutiveHealthFailures < HEALTH_CHECK_MAX_CONSECUTIVE_FAILURES) return;
        if (shouldSkipRestartForBusySessions()) return;
        console.log(`[lifecycle] ${source} health check failure threshold reached, restarting ax-code...`);
        consecutiveHealthFailures = 0;
        lastHealthProbeResult = null;
        await restartAxCode();
      } else {
        resetHealthFailureState();
      }
    })().finally(() => {
      healthCheckCyclePromise = null;
    });

    return healthCheckCyclePromise;
  };

  const triggerHealthCheck = async () => {
    try {
      await runHealthCheckCycle('immediate');
    } catch (error) {
      console.error(`[lifecycle] immediate health check error: ${error.message}`);
    }
  };

  const startHealthMonitoring = (healthCheckIntervalMs) => {
    if (state.healthCheckInterval) {
      clearInterval(state.healthCheckInterval);
    }

    const effectiveIntervalMs = HEALTH_CHECK_INTERVAL_OVERRIDE_MS || healthCheckIntervalMs;

    state.healthCheckInterval = setInterval(async () => {
      try {
        await runHealthCheckCycle('periodic');
      } catch (error) {
        console.error(`Health check error: ${error.message}`);
      }
    }, effectiveIntervalMs);
  };

  const shutdown = () => {
    state.isShuttingDown = true;
    startupAbortController?.abort();
    if (state.healthCheckInterval) {
      clearInterval(state.healthCheckInterval);
      state.healthCheckInterval = null;
    }
  };

  return {
    killProcessOnPort,
    startAxCode,
    restartAxCode,
    waitForAxCodeReady,
    waitForAgentPresence,
    refreshAxCodeAfterConfigChange,
    bootstrapAxCodeAtStartup,
    startHealthMonitoring,
    triggerHealthCheck,
    waitForPortRelease,
    shutdown,
  };
};
