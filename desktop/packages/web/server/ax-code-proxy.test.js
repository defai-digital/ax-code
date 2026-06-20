import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import express from 'express';
import path from 'path';

import {
  createCompatibilityRewriteCounter,
  createSseBoundaryTracker,
  createSseProxyMetrics,
  registerAxCodeProxy,
  writeSseChunkWithBackpressure,
} from './lib/ax-code/proxy.js';

const listen = (app, host = '127.0.0.1') => new Promise((resolve, reject) => {
  const server = app.listen(0, host, () => resolve(server));
  server.once('error', reject);
});

const closeServer = (server) => new Promise((resolve, reject) => {
  if (!server) {
    resolve();
    return;
  }
  server.close((error) => {
    if (error) {
      reject(error);
      return;
    }
    resolve();
  });
});

describe('AX Code proxy SSE forwarding', () => {
  let upstreamServer;
  let proxyServer;

  afterEach(async () => {
    await closeServer(proxyServer);
    await closeServer(upstreamServer);
    proxyServer = undefined;
    upstreamServer = undefined;
  });

  it('forwards event streams with nginx-safe headers', async () => {
    let seenAuthorization = null;

    const upstream = express();
    upstream.get('/global/event', (req, res) => {
      seenAuthorization = req.headers.authorization ?? null;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'private, max-age=0');
      res.setHeader('X-Upstream-Test', 'ok');
      res.write('data: {"ok":true}\n\n');
      res.end();
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;

    const app = express();
    registerAxCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        axCodePort: upstreamPort,
        isAxCodeReady: true,
        axCodeNotReadySince: 0,
        isRestartingAxCode: false,
      }),
      getAxCodeAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
      buildAxCodeUrl: (requestPath) => `http://127.0.0.1:${upstreamPort}${requestPath}`,
      ensureAxCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/global/event`, {
      headers: { Accept: 'text/event-stream' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    expect(response.headers.get('x-upstream-test')).toBe('ok');
    expect(await response.text()).toBe('data: {"ok":true}\n\n');
    expect(seenAuthorization).toBe('Bearer test-token');
  });

  it('waits for drain when writing to a slow SSE response', async () => {
    const writes = [];
    const res = new EventEmitter();
    res.writableEnded = false;
    res.destroyed = false;
    res.write = (value) => {
      writes.push(value);
      return false;
    };
    const controller = new AbortController();

    const write = writeSseChunkWithBackpressure(res, Buffer.from('data: {"ok":true}\n\n'), controller.signal);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writes).toHaveLength(1);

    res.emit('drain');

    await expect(write).resolves.toBe(true);
  });

  it('tracks whether a raw SSE stream is between event blocks', () => {
    const tracker = createSseBoundaryTracker();

    expect(tracker.isAtBoundary()).toBe(true);
    expect(tracker.observe(Buffer.from('id: evt-1\n'))).toBe(false);
    expect(tracker.observe(Buffer.from('data: {"ok"'))).toBe(false);
    expect(tracker.observe(Buffer.from(':true}\n'))).toBe(false);
    expect(tracker.observe(Buffer.from('\n'))).toBe(true);
    expect(tracker.observe(Buffer.from('data: next\r\n\r\n'))).toBe(true);
  });

  it('records SSE latency, disconnect reason, and backpressure waits', () => {
    let current = 1000;
    const metrics = createSseProxyMetrics({ now: () => current });

    const id = metrics.begin('/global/event');
    current = 1020;
    metrics.markUpstreamConnected(id, { status: 200 });
    current = 1075;
    expect(metrics.markFirstChunk(id, { bytes: 21 })).toEqual({
      firstChunkLatencyMs: 75,
      upstreamFirstChunkLatencyMs: 55,
    });
    metrics.recordBackpressureWait(id, 12);
    current = 1100;
    metrics.finish(id, 'client-disconnect');

    expect(metrics.snapshot()).toMatchObject({
      totals: {
        started: 1,
        completed: 1,
        clientDisconnects: 1,
        upstreamErrors: 0,
        backpressureWaits: 1,
      },
      active: 0,
      recent: [
        {
          requestPath: '/global/event',
          reason: 'client-disconnect',
          durationMs: 100,
          firstChunkLatencyMs: 75,
          upstreamFirstChunkLatencyMs: 55,
          firstChunkBytes: 21,
          backpressureWaitCount: 1,
          backpressureWaitMs: 12,
        },
      ],
    });
  });

  it('lets provider auth writes through while providers are still warming', async () => {
    const upstream = express();
    let sawPut = false;
    upstream.put('/auth/openai', (_req, res) => {
      sawPut = true;
      res.json({ ok: true });
    });
    upstream.get('/config/providers', (_req, res) => {
      res.json({ providers: [] });
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;

    const app = express();
    registerAxCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 12000,
      getRuntime: () => ({
        axCodePort: upstreamPort,
        isAxCodeReady: true,
        axCodeNotReadySince: 0,
        isRestartingAxCode: false,
        axCodeRuntimeHealth: {
          readiness: { providersReady: false },
          startup: { uptimeMs: 100 },
        },
      }),
      getAxCodeAuthHeaders: () => ({}),
      buildAxCodeUrl: (requestPath) => `http://127.0.0.1:${upstreamPort}${requestPath}`,
      ensureAxCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    // Adding a provider (a write) must never be blocked by provider readiness.
    const put = await fetch(`http://127.0.0.1:${proxyPort}/api/auth/openai`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'api', key: 'sk-test' }),
    });
    expect(put.status).toBe(200);
    expect(sawPut).toBe(true);

    // Provider reads are NOT gated by provider warmup: a first-run user with no
    // providers configured must be able to load the (correctly empty) list to
    // add their first provider, even while providersReady is still false.
    const get = await fetch(`http://127.0.0.1:${proxyPort}/api/config/providers`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ providers: [] });
  });

  it('serves provider reads once the core is ready, regardless of provider warmup', async () => {
    const upstream = express();
    upstream.get('/config/providers', (_req, res) => {
      res.json({ providers: [] });
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;

    const app = express();
    registerAxCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 12000,
      getRuntime: () => ({
        axCodePort: upstreamPort,
        isAxCodeReady: true,
        axCodeNotReadySince: 0,
        isRestartingAxCode: false,
        axCodeRuntimeHealth: {
          // Early uptime + providersReady:false — the old code would have 503'd
          // this; it must now pass through since the core is ready.
          readiness: { providersReady: false },
          startup: { uptimeMs: 100 },
        },
      }),
      getAxCodeAuthHeaders: () => ({}),
      buildAxCodeUrl: (requestPath) => `http://127.0.0.1:${upstreamPort}${requestPath}`,
      ensureAxCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const get = await fetch(`http://127.0.0.1:${proxyPort}/api/config/providers`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ providers: [] });
  });

  it('rewrites stale config-prefixed provider SDK paths to canonical provider paths', async () => {
    const seenPaths = [];
    const upstream = express();
    upstream.get('/provider', (req, res) => {
      seenPaths.push(req.path);
      res.json({ all: [] });
    });
    upstream.get('/provider/auth', (req, res) => {
      seenPaths.push(req.path);
      res.json({});
    });
    upstream.get('/config/providers', (req, res) => {
      seenPaths.push(req.path);
      res.json({ providers: [] });
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;

    const app = express();
    registerAxCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        axCodePort: upstreamPort,
        isAxCodeReady: true,
        axCodeNotReadySince: 0,
        isRestartingAxCode: false,
      }),
      getAxCodeAuthHeaders: () => ({}),
      buildAxCodeUrl: (requestPath) => `http://127.0.0.1:${upstreamPort}${requestPath}`,
      ensureAxCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const providerList = await fetch(`http://127.0.0.1:${proxyPort}/api/config/provider`);
    const providerAuth = await fetch(`http://127.0.0.1:${proxyPort}/api/config/provider/auth`);
    const configProviders = await fetch(`http://127.0.0.1:${proxyPort}/api/config/config/providers`);

    expect(providerList.status).toBe(200);
    expect(providerAuth.status).toBe(200);
    expect(configProviders.status).toBe(200);
    expect(seenPaths).toEqual(['/provider', '/provider/auth', '/config/providers']);
  });

  it('counts compatibility rewrites when stale provider paths are rewritten', async () => {
    const upstream = express();
    upstream.get('/provider', (_req, res) => res.json({ all: [] }));
    upstream.get('/provider/auth', (_req, res) => res.json({}));
    upstream.get('/config/providers', (_req, res) => res.json({ providers: [] }));
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;

    const rewriteCounter = createCompatibilityRewriteCounter();
    const app = express();
    registerAxCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        axCodePort: upstreamPort,
        isAxCodeReady: true,
        axCodeNotReadySince: 0,
        isRestartingAxCode: false,
      }),
      getAxCodeAuthHeaders: () => ({}),
      buildAxCodeUrl: (requestPath) => `http://127.0.0.1:${upstreamPort}${requestPath}`,
      ensureAxCodeApiPrefix: () => {},
      rewriteCounter,
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    expect(rewriteCounter.snapshot()).toEqual({ provider: 0, configProviders: 0, total: 0 });

    await fetch(`http://127.0.0.1:${proxyPort}/api/config/provider`);
    await fetch(`http://127.0.0.1:${proxyPort}/api/config/provider/auth`);
    expect(rewriteCounter.snapshot()).toEqual({ provider: 2, configProviders: 0, total: 2 });

    await fetch(`http://127.0.0.1:${proxyPort}/api/config/config/providers`);
    expect(rewriteCounter.snapshot()).toEqual({ provider: 2, configProviders: 1, total: 3 });

    await fetch(`http://127.0.0.1:${proxyPort}/api/provider/auth`);
    expect(rewriteCounter.snapshot()).toEqual({ provider: 2, configProviders: 1, total: 3 });
  });

  it('routes generic API requests through external AX Code base URL', async () => {
    const upstream = express();
    upstream.get('/config/providers', (_req, res) => {
      res.json({ ok: true, source: 'external-host' });
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;
    const externalBaseUrl = `http://127.0.0.1:${upstreamPort}`;

    const app = express();
    registerAxCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        axCodePort: 3902,
        axCodeBaseUrl: externalBaseUrl,
        isAxCodeReady: true,
        axCodeNotReadySince: 0,
        isRestartingAxCode: false,
      }),
      getAxCodeAuthHeaders: () => ({}),
      buildAxCodeUrl: (requestPath) => `${externalBaseUrl}${requestPath}`,
      ensureAxCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/config/providers`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, source: 'external-host' });
  });

  it('signals restarting:true in proxy error when ax-code is not ready', async () => {
    // Point to a port where nothing is listening — the proxy middleware will
    // get ECONNREFUSED and fire the error handler.  Because the runtime says
    // the upstream is not ready yet, the 503 must include `restarting: true`
    // so clients keep polling instead of dead-ending.
    const app = express();
    registerAxCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        axCodePort: 1,  // nothing listening on port 1
        isAxCodeReady: false,
        axCodeNotReadySince: Date.now(),
        isRestartingAxCode: false,
      }),
      getAxCodeAuthHeaders: () => ({}),
      buildAxCodeUrl: (requestPath) => `http://127.0.0.1:1${requestPath}`,
      ensureAxCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/config/providers`);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.restarting).toBe(true);
  });

  it('signals restarting:true in proxy error even when runtime readiness is stale-healthy', async () => {
    // The error callback ONLY fires when the proxy could not complete the
    // upstream request (ECONNREFUSED / socket hangup / timeout). That is
    // always transient from the client's perspective, so the 503 MUST include
    // `restarting: true` regardless of the (possibly stale) runtime readiness
    // flags. A health check can pass moments before ax-code crashes or becomes
    // unreachable, leaving isAxCodeReady=true while the connection fails.
    // Gating the flag on stale state previously emitted a bare 503 (no
    // `restarting`), which the Desktop treated as a terminal error — surfacing
    // "Failed to load provider authentication methods" on the Providers page
    // even though the provider list (persisted in the config store) still
    // appeared. Signalling `restarting: true` keeps the uncached auth-methods
    // / available-providers loaders polling until the upstream recovers.
    const app = express();
    registerAxCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        axCodePort: 1,
        isAxCodeReady: true,
        axCodeNotReadySince: 0,
        isRestartingAxCode: false,
      }),
      getAxCodeAuthHeaders: () => ({}),
      buildAxCodeUrl: (requestPath) => `http://127.0.0.1:1${requestPath}`,
      ensureAxCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/config/providers`);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.restarting).toBe(true);
  });

  it('signals restarting:true in SSE forwarder when ax-code is unreachable', async () => {
    // The SSE forwarder (forwardSseRequest) handles /api/event and
    // /api/global/event. When the initial fetch to ax-code fails with
    // ECONNREFUSED (upstream unreachable), the catch block must emit a 503
    // with `restarting: true` — matching the apiProxy error handler and the
    // readiness gate contract. A bare 503 (no `restarting`) would let
    // clients dead-end on the unreachability instead of reconnecting/polling.
    const app = express();
    registerAxCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        axCodePort: 1,  // nothing listening — fetch throws ECONNREFUSED
        isAxCodeReady: true,
        axCodeNotReadySince: 0,
        isRestartingAxCode: false,
      }),
      getAxCodeAuthHeaders: () => ({}),
      buildAxCodeUrl: (requestPath) => `http://127.0.0.1:1${requestPath}`,
      ensureAxCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/global/event`, {
      headers: { Accept: 'text/event-stream' },
    });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.restarting).toBe(true);
  });
});
