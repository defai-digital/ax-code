import { createProxyMiddleware } from 'http-proxy-middleware';

import {
  applyForwardProxyResponseHeaders,
  collectForwardProxyHeaders,
  shouldForwardProxyResponseHeader,
} from '../../proxy-headers.js';
import { createRealpathCache } from '../path-realpath-cache.js';

export const createDirectoryQueryCanonicalizer = ({ realpath, ...cacheOptions } = {}) => {
  const realpathCache = createRealpathCache({ fallbackOnError: true, realpath, ...cacheOptions });

  return async (requestUrl) => {
    if (typeof requestUrl !== 'string' || !requestUrl.includes('directory=')) {
      return requestUrl;
    }

    const url = new URL(requestUrl, 'http://localhost');
    const directory = url.searchParams.get('directory');
    if (!directory) {
      return requestUrl;
    }

    const canonicalDirectory = await realpathCache.resolve(directory);
    if (!canonicalDirectory || canonicalDirectory === directory) {
      return requestUrl;
    }

    url.searchParams.set('directory', canonicalDirectory);
    return `${url.pathname}${url.search}`;
  };
};

export const isAxCodeReadinessValueReady = (value) => value === true || value === 'ready';

export const waitForSseDrain = (res, signal) => new Promise((resolve) => {
  if (signal?.aborted || res.writableEnded || res.destroyed) {
    resolve();
    return;
  }

  const cleanup = () => {
    res.off?.('drain', onDone);
    res.off?.('close', onDone);
    res.off?.('error', onDone);
    signal?.removeEventListener?.('abort', onDone);
  };
  const onDone = () => {
    cleanup();
    resolve();
  };

  res.once?.('drain', onDone);
  res.once?.('close', onDone);
  res.once?.('error', onDone);
  signal?.addEventListener?.('abort', onDone, { once: true });
});

export const writeSseChunkWithBackpressure = async (res, value, signal, onBackpressureWait) => {
  if (!value || value.length === 0 || signal?.aborted || res.writableEnded || res.destroyed) {
    return false;
  }

  const flushed = res.write(value);
  if (flushed !== false) {
    return true;
  }

  const waitStartedAt = Date.now();
  await waitForSseDrain(res, signal);
  if (typeof onBackpressureWait === 'function') {
    onBackpressureWait(Math.max(0, Date.now() - waitStartedAt));
  }
  return !signal?.aborted && !res.writableEnded && !res.destroyed;
};

export const createSseProxyMetrics = (options = {}) => {
  const {
    now = () => Date.now(),
    maxRecentStreams = 20,
  } = options;

  let nextId = 1;
  const active = new Map();
  const recent = [];
  const totals = {
    started: 0,
    completed: 0,
    clientDisconnects: 0,
    upstreamErrors: 0,
    backpressureWaits: 0,
  };

  const pushRecent = (entry) => {
    recent.push(entry);
    while (recent.length > maxRecentStreams) {
      recent.shift();
    }
  };

  const begin = (requestPath) => {
    const id = nextId++;
    const startedAtEpochMs = now();
    active.set(id, {
      id,
      requestPath,
      startedAtEpochMs,
      upstreamConnectedAtEpochMs: null,
      firstChunkAtEpochMs: null,
      firstChunkBytes: 0,
      backpressureWaitMs: 0,
      backpressureWaitCount: 0,
      chunkCount: 0,
      totalBytes: 0,
    });
    totals.started += 1;
    return id;
  };

  const markUpstreamConnected = (id, details = {}) => {
    const stream = active.get(id);
    if (!stream || stream.upstreamConnectedAtEpochMs) return;
    stream.upstreamConnectedAtEpochMs = now();
    stream.upstreamStatus = details.status ?? null;
  };

  const markFirstChunk = (id, details = {}) => {
    const stream = active.get(id);
    if (!stream || stream.firstChunkAtEpochMs) return null;
    stream.firstChunkAtEpochMs = now();
    stream.firstChunkBytes = details.bytes ?? 0;
    return {
      firstChunkLatencyMs: Math.max(0, stream.firstChunkAtEpochMs - stream.startedAtEpochMs),
      upstreamFirstChunkLatencyMs: stream.upstreamConnectedAtEpochMs
        ? Math.max(0, stream.firstChunkAtEpochMs - stream.upstreamConnectedAtEpochMs)
        : null,
    };
  };

  const recordBackpressureWait = (id, waitMs) => {
    const stream = active.get(id);
    if (!stream) return;
    stream.backpressureWaitCount += 1;
    stream.backpressureWaitMs += Math.max(0, waitMs);
    totals.backpressureWaits += 1;
  };

  const recordChunk = (id, bytes = 0) => {
    const stream = active.get(id);
    if (!stream) return;
    stream.chunkCount += 1;
    stream.totalBytes += bytes;
  };

  const finish = (id, reason = 'complete', details = {}) => {
    const stream = active.get(id);
    if (!stream) return null;
    active.delete(id);

    const finishedAtEpochMs = now();
    const entry = {
      id,
      requestPath: stream.requestPath,
      reason,
      startedAtEpochMs: stream.startedAtEpochMs,
      finishedAtEpochMs,
      durationMs: Math.max(0, finishedAtEpochMs - stream.startedAtEpochMs),
      upstreamStatus: stream.upstreamStatus ?? null,
      firstChunkLatencyMs: stream.firstChunkAtEpochMs
        ? Math.max(0, stream.firstChunkAtEpochMs - stream.startedAtEpochMs)
        : null,
      upstreamFirstChunkLatencyMs: stream.firstChunkAtEpochMs && stream.upstreamConnectedAtEpochMs
        ? Math.max(0, stream.firstChunkAtEpochMs - stream.upstreamConnectedAtEpochMs)
        : null,
      firstChunkBytes: stream.firstChunkBytes,
      backpressureWaitCount: stream.backpressureWaitCount,
      backpressureWaitMs: stream.backpressureWaitMs,
      chunkCount: stream.chunkCount,
      totalBytes: stream.totalBytes,
      ...details,
    };

    totals.completed += 1;
    if (reason === 'client-disconnect') totals.clientDisconnects += 1;
    if (reason === 'upstream-error') totals.upstreamErrors += 1;
    pushRecent(entry);
    return entry;
  };

  const snapshot = () => ({
    totals: { ...totals },
    active: active.size,
    recent: [...recent],
  });

  return {
    begin,
    markUpstreamConnected,
    markFirstChunk,
    recordBackpressureWait,
    recordChunk,
    finish,
    snapshot,
  };
};

export const createCompatibilityRewriteCounter = () => {
  const counts = { provider: 0, configProviders: 0 };

  return {
    increment(kind) {
      if (kind in counts) counts[kind] += 1;
    },
    snapshot() {
      return { ...counts, total: counts.provider + counts.configProviders };
    },
    reset() {
      counts.provider = 0;
      counts.configProviders = 0;
    },
  };
};

export const createSseBoundaryTracker = () => {
  const decoder = new TextDecoder();
  let tail = '';

  const normalize = (value) => value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  return {
    observe(value) {
      const text = typeof value === 'string'
        ? value
        : decoder.decode(value, { stream: true });
      if (text.length > 0) {
        tail = `${tail}${normalize(text)}`;
        if (tail.length > 4096) {
          tail = tail.slice(-4096);
        }
      }
      return this.isAtBoundary();
    },
    isAtBoundary() {
      return tail.length === 0 || tail.endsWith('\n\n');
    },
  };
};

export const registerAxCodeProxy = (app, deps) => {
  const {
    fs,
    os,
    path,
    OPEN_CODE_READY_GRACE_MS,
    getRuntime,
    getAxCodeAuthHeaders,
    buildAxCodeUrl,
    ensureAxCodeApiPrefix,
    sseMetrics = null,
    rewriteCounter = createCompatibilityRewriteCounter(),
    recordStartupEvent = null,
    settingsFilePath = null,
  } = deps;

  if (app.get('axCodeProxyConfigured')) {
    return;
  }

  const runtime = getRuntime();
  if (runtime.axCodePort) {
    console.log(`Setting up proxy to ax-code on port ${runtime.axCodePort}`);
  } else {
    console.log('Setting up ax-code API gate (ax-code not started yet)');
  }
  app.set('axCodeProxyConfigured', true);
  app.set('rewriteCounter', rewriteCounter);

  const isAbortError = (error) => error?.name === 'AbortError';
  const FALLBACK_PROXY_TARGET = 'http://127.0.0.1:3902';
  const canonicalizeDirectoryQuery = createDirectoryQueryCanonicalizer({
    realpath: fs?.promises?.realpath?.bind(fs.promises),
  });

  const normalizeProxyTarget = (candidate) => {
    if (typeof candidate !== 'string') {
      return null;
    }

    const trimmed = candidate.trim();
    if (!trimmed) {
      return null;
    }

    return trimmed.replace(/\/+$/, '');
  };

  // Keep generic proxy requests on the same upstream base URL that health checks
  // and direct fetch helpers use. This avoids split-brain state where /health
  // succeeds against an external host but /api/* still proxies to 127.0.0.1.
  const resolveProxyTarget = () => {
    try {
      const resolved = normalizeProxyTarget(buildAxCodeUrl('/', ''));
      if (resolved) {
        return resolved;
      }
    } catch {
    }

    const runtimeState = getRuntime();
    const externalBase = normalizeProxyTarget(runtimeState.axCodeBaseUrl);
    if (externalBase) {
      return externalBase;
    }

    if (runtimeState.axCodePort) {
      return `http://localhost:${runtimeState.axCodePort}`;
    }

    return FALLBACK_PROXY_TARGET;
  };

  const forwardSseRequest = async (req, res) => {
    const abortController = new AbortController();
    let closedByClient = false;
    const closeUpstream = () => {
      closedByClient = true;
      abortController.abort();
    };
    let upstream = null;
    let reader = null;
    let heartbeatTimer = null;
    let writeQueue = Promise.resolve(true);
    const sseBoundary = createSseBoundaryTracker();
    let streamMetricId = null;
    let upstreamPath = '';
    let finishedMetric = false;

    const finishMetric = (reason, details = {}) => {
      if (!sseMetrics || !streamMetricId || finishedMetric) return;
      finishedMetric = true;
      const entry = sseMetrics.finish(streamMetricId, reason, details);
      if (entry && reason !== 'complete') {
        console.warn(`[proxy] ax-code SSE ${reason}: ${upstreamPath || 'unknown'} (${entry.durationMs}ms)`);
      }
    };

    req.on('close', closeUpstream);

    try {
      const requestUrl = typeof req.originalUrl === 'string' && req.originalUrl.length > 0
        ? req.originalUrl
        : (typeof req.url === 'string' ? req.url : '');
      upstreamPath = requestUrl.startsWith('/api') ? requestUrl.slice(4) || '/' : requestUrl;
      streamMetricId = sseMetrics?.begin(upstreamPath) ?? null;
      const headers = collectForwardProxyHeaders(req.headers, getAxCodeAuthHeaders());
      headers.accept ??= 'text/event-stream';
      headers['cache-control'] ??= 'no-cache';

      upstream = await fetch(buildAxCodeUrl(upstreamPath, ''), {
        method: 'GET',
        headers,
        signal: abortController.signal,
      });
      sseMetrics?.markUpstreamConnected(streamMetricId, { status: upstream.status });

      res.status(upstream.status);
      applyForwardProxyResponseHeaders(upstream.headers, res);

      const contentType = upstream.headers.get('content-type') || 'text/event-stream';
      const isEventStream = contentType.toLowerCase().includes('text/event-stream');

      if (!upstream.body) {
        res.end(await upstream.text().catch(() => ''));
        return;
      }

      if (!isEventStream) {
        res.end(await upstream.text());
        return;
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }

      // Disable TCP Nagle's algorithm so small SSE chunks are sent immediately
      // instead of being buffered up to ~200ms by the TCP stack.
      if (res.socket && typeof res.socket.setNoDelay === 'function') {
        res.socket.setNoDelay(true);
      }

      const SSE_HEARTBEAT_INTERVAL_MS = 20_000;

      const scheduleHeartbeat = () => {
        heartbeatTimer = setTimeout(async () => {
          if (abortController.signal.aborted || res.writableEnded || res.destroyed) {
            return;
          }
          if (!sseBoundary.isAtBoundary()) {
            scheduleHeartbeat();
            return;
          }
          const canContinue = await enqueueSseWrite(':heartbeat\n\n');
          if (canContinue) {
            scheduleHeartbeat();
          }
        }, SSE_HEARTBEAT_INTERVAL_MS);
      };

      const enqueueSseWrite = (value) => {
        writeQueue = writeQueue
          .catch(() => false)
          .then((canContinue) => {
            if (!canContinue) {
              return false;
            }
            return writeSseChunkWithBackpressure(res, value, abortController.signal, (waitMs) => {
              sseMetrics?.recordBackpressureWait(streamMetricId, waitMs);
            });
          });
        return writeQueue;
      };

      scheduleHeartbeat();

      reader = upstream.body.getReader();
      while (!abortController.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value && value.length > 0) {
          const firstChunk = sseMetrics?.markFirstChunk(streamMetricId, { bytes: value.length });
          sseMetrics?.recordChunk(streamMetricId, value.length);
          if (firstChunk && typeof recordStartupEvent === 'function') {
            recordStartupEvent('stream.first_token', {
              requestPath: upstreamPath,
              firstChunkLatencyMs: firstChunk.firstChunkLatencyMs,
              upstreamFirstChunkLatencyMs: firstChunk.upstreamFirstChunkLatencyMs,
            }, { source: 'web-server', milestone: 'stream.first_token' });
          }
          sseBoundary.observe(value);
          const canContinue = await enqueueSseWrite(value);
          if (!canContinue) {
            break;
          }
        }
      }

      res.end();
      finishMetric(closedByClient ? 'client-disconnect' : 'complete');
    } catch (error) {
      if (isAbortError(error)) {
        finishMetric(closedByClient ? 'client-disconnect' : 'aborted');
        return;
      }
      console.error('[proxy] ax-code SSE proxy error:', error?.message ?? error);
      finishMetric('upstream-error', { error: error?.message ?? String(error) });
      if (!res.headersSent) {
        // This branch only fires when the initial fetch to ax-code failed
        // (ECONNREFUSED / socket hangup / timeout) before any headers were
        // flushed — i.e. ax-code was unreachable for THIS request. That is
        // always transient from the client's perspective, so signal
        // `restarting: true` to match the apiProxy error handler and the
        // readiness gate contract. A bare 503 (no `restarting`) previously
        // let EventSource clients dead-end instead of reconnecting/polling.
        res.status(503).json({
          error: 'ax-code service unavailable',
          restarting: true,
        });
      } else {
        res.end();
      }
    } finally {
      if (heartbeatTimer) {
        clearTimeout(heartbeatTimer);
        heartbeatTimer = null;
      }
      req.off('close', closeUpstream);
      try {
        if (reader) {
          await reader.cancel();
          reader.releaseLock();
        } else if (upstream?.body && !upstream.body.locked) {
          await upstream.body.cancel();
        }
      } catch {
      }
      finishMetric(closedByClient ? 'client-disconnect' : 'complete');
    }
  };

  // Ensure API prefix is detected before proxying
  app.use('/api', (_req, _res, next) => {
    ensureAxCodeApiPrefix();
    next();
  });

  // Compatibility for stale/misconfigured UI clients that used `/api/config`
  // as the SDK base URL. SDK provider reads then become `/api/config/provider*`
  // and config-provider reads become `/api/config/config/providers`, which
  // upstream ax-code correctly returns as 404. Rewrite them to the canonical
  // API root paths so the Providers page can recover without a manual reload.
  app.use('/api', (req, _res, next) => {
    if (req.url === '/config/provider' || req.url.startsWith('/config/provider?') || req.url.startsWith('/config/provider/')) {
      req.url = req.url.replace(/^\/config\/provider(?=$|[/?])/, '/provider');
      rewriteCounter.increment('provider');
    } else if (req.url === '/config/config/providers' || req.url.startsWith('/config/config/providers?')) {
      req.url = req.url.replace(/^\/config\/config\/providers(?=$|[/?])/, '/config/providers');
      rewriteCounter.increment('configProviders');
    }
    next();
  });

  // Readiness gate — return 503 while ax-code is starting/restarting
  app.use('/api', (req, res, next) => {
    // Provider reads (provider list, auth methods) are intentionally NOT gated
    // by provider "warmup" readiness. For a first-run user with no providers
    // configured, `providersReady` can stay not-ready even though the
    // (correctly empty) list is already serveable — gating it just turns a
    // transient warmup into a hard "Unable to load providers" error and blocks
    // the very flow used to add a first provider. Provider requests are gated
    // only by genuine core readiness (below); the UI keeps polling a
    // 503 {restarting:true} instead of dead-ending.
    if (
      req.path.startsWith('/themes/custom') ||
      req.path.startsWith('/push') ||
      req.path.startsWith('/config/agents') ||
      req.path.startsWith('/config/ax-code-resolution') ||
      req.path.startsWith('/config/settings') ||
      req.path.startsWith('/config/skills') ||
      req.path === '/config/reload' ||
      req.path === '/health'
    ) {
      return next();
    }

    const runtimeState = getRuntime();
    const waitElapsed = runtimeState.axCodeNotReadySince === 0 ? 0 : Date.now() - runtimeState.axCodeNotReadySince;
    const stillWaiting =
      (!runtimeState.isAxCodeReady && (runtimeState.axCodeNotReadySince === 0 || waitElapsed < OPEN_CODE_READY_GRACE_MS)) ||
      runtimeState.isRestartingAxCode ||
      !runtimeState.axCodePort;
    if (stillWaiting) {
      return res.status(503).json({
        error: 'ax-code is restarting',
        restarting: true,
      });
    }

    next();
  });

  // Windows: session merge for cross-directory session listing
  if (process.platform === 'win32') {
    app.get('/api/session', async (req, res, next) => {
      const rawUrl = req.originalUrl || req.url || '';
      if (rawUrl.includes('directory=')) return next();

      try {
        const authHeaders = getAxCodeAuthHeaders();
        const fetchOpts = {
          method: 'GET',
          headers: { Accept: 'application/json', ...authHeaders },
          signal: AbortSignal.timeout(10000),
        };
        const globalRes = await fetch(buildAxCodeUrl('/session', ''), fetchOpts);
        let globalPayload = [];
        if (globalRes.ok) {
          globalPayload = await globalRes.json().catch(() => []);
        } else {
          globalRes.body?.cancel();
        }
        const globalSessions = Array.isArray(globalPayload) ? globalPayload : [];

        const settingsPath = settingsFilePath || path.join(os.homedir(), '.config', 'openchamber', 'settings.json');
        let projectDirs = [];
        try {
          const settingsRaw = await fs.promises.readFile(settingsPath, 'utf8');
          const settings = JSON.parse(settingsRaw);
          projectDirs = (settings.projects || [])
            .map((project) => (typeof project?.path === 'string' ? project.path.trim() : ''))
            .filter(Boolean);
        } catch {
        }

        const seen = new Set(
          globalSessions
            .map((session) => (session && typeof session.id === 'string' ? session.id : null))
            .filter((id) => typeof id === 'string')
        );
        const extraSessions = [];

        const allCandidates = projectDirs.flatMap((dir) =>
          Array.from(new Set([dir, dir.replace(/\\/g, '/'), dir.replace(/\//g, '\\')]))
        );

        const dirResults = await Promise.all(
          allCandidates.map(async (candidateDir) => {
            const encoded = encodeURIComponent(candidateDir);
            try {
              const dirRes = await fetch(buildAxCodeUrl(`/session?directory=${encoded}`, ''), fetchOpts);
              if (dirRes.ok) {
                const dirPayload = await dirRes.json().catch(() => []);
                return Array.isArray(dirPayload) ? dirPayload : [];
              } else {
                dirRes.body?.cancel();
              }
            } catch {
            }
            return [];
          })
        );

        for (const sessions of dirResults) {
          for (const session of sessions) {
            const id = session && typeof session.id === 'string' ? session.id : null;
            if (id && !seen.has(id)) {
              seen.add(id);
              extraSessions.push(session);
            }
          }
        }

        const merged = [...globalSessions, ...extraSessions];
        merged.sort((a, b) => {
          const aTime = a && typeof a.time?.updated === 'number' ? a.time.updated : 0;
          const bTime = b && typeof b.time?.updated === 'number' ? b.time.updated : 0;
          return bTime - aTime;
        });
        console.log(`[SessionMerge] ${globalSessions.length} global + ${extraSessions.length} extra = ${merged.length} total`);
        return res.json(merged);
      } catch (error) {
        console.log(`[SessionMerge] Error: ${error.message}, falling through`);
        next();
      }
    });
  }

  app.get('/api/global/event', forwardSseRequest);
  app.get('/api/event', forwardSseRequest);

  // Generic proxy for non-SSE ax-code API routes.
  const apiProxy = createProxyMiddleware({
    target: resolveProxyTarget(),
    changeOrigin: true,
    pathRewrite: { '^/api': '' },
    // Dynamic target — port can change after restart
    router: () => resolveProxyTarget(),
    on: {
      proxyReq: (proxyReq) => {
        // Inject ax-code auth headers
        const authHeaders = getAxCodeAuthHeaders();
        if (authHeaders.Authorization) {
          proxyReq.setHeader('Authorization', authHeaders.Authorization);
        }

        // Strip browser Origin header — ax-code validates Origin against its own
        // server origin and rejects requests from the sidecar's port with
        // "origin mismatch". This is server-to-server proxy traffic; no Origin needed.
        proxyReq.removeHeader('origin');

        // Defensive: request identity encoding from upstream ax-code.
        // This avoids compressed-body/header mismatches in multi-proxy setups.
        proxyReq.setHeader('accept-encoding', 'identity');
      },
      proxyRes: (proxyRes) => {
        for (const key of Object.keys(proxyRes.headers || {})) {
          if (!shouldForwardProxyResponseHeader(key)) {
            delete proxyRes.headers[key];
          }
        }
      },
      error: (err, _req, res) => {
        console.error('[proxy] ax-code proxy error:', err.message);
        if (res && !res.headersSent && typeof res.status === 'function') {
          // This callback only fires when the proxy could not complete the
          // upstream request (ECONNREFUSED, socket hangup, timeout, etc.) —
          // i.e. ax-code was unreachable for THIS request. That is always
          // transient from the client's perspective, so signal
          // `restarting: true` so clients keep polling instead of
          // dead-ending on "Unable to load providers" / "Failed to load
          // provider authentication methods".
          //
          // Do NOT gate this on the desktop's readiness flags: a health
          // check can pass moments before ax-code crashes or becomes
          // unreachable, leaving isAxCodeReady=true while the connection
          // fails. Gating on stale state then emits a bare 503 (no
          // `restarting`), which the Desktop treats as a terminal error.
          // The provider list survives because it is persisted in the
          // config store and silently re-polls, but the uncached
          // auth-methods / available-providers loaders dead-end — making
          // the panel look "loaded but broken".
          res.status(503).json({
            error: 'ax-code service unavailable',
            restarting: true,
          });
        }
      },
    },
  });

  // Best-effort fallback for stale clients still sending symlink paths.
  // Settings and project selection normalize at source; this cached async path
  // avoids blocking the proxy hot path on every directory-scoped request.
  app.use('/api', async (req, _res, next) => {
    try {
      const rewrittenUrl = await canonicalizeDirectoryQuery(req.url);
      if (rewrittenUrl !== req.url) {
        req.url = rewrittenUrl;
      }
    } catch {
      // Pass through as-is if URL parsing or realpath resolution fails.
    }
    next();
  });

  app.use('/api', apiProxy);
};
