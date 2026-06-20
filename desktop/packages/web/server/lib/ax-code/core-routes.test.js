import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { registerAuthAndAccessRoutes, registerCommonRequestMiddleware, registerServerStatusRoutes, registerSettingsUtilityRoutes } from './core-routes.js';

describe('core-routes', () => {
  it('should call gracefulShutdown with exitProcess: true on /api/system/shutdown', async () => {
    const app = express();
    let shutdownOpts = null;
    const dependencies = {
      gracefulShutdown: vi.fn(async (opts) => {
        shutdownOpts = opts;
      }),
      getHealthSnapshot: () => ({ status: 'ok' }),
      openchamberVersion: '1.0.0',
      runtimeName: 'test',
      express,
    };

    registerServerStatusRoutes(app, dependencies);

    await request(app).post('/api/system/shutdown');

    expect(dependencies.gracefulShutdown).toHaveBeenCalled();
    expect(shutdownOpts).toEqual({ exitProcess: true });
  });

  it('serves sanitized startup diagnostics when available', async () => {
    const app = express();
    registerServerStatusRoutes(app, {
      gracefulShutdown: vi.fn(),
      getHealthSnapshot: () => ({ status: 'ok' }),
      getStartupDiagnosticsSnapshot: () => ({
        bootId: 'boot-a',
        events: [{ name: 'electron.app.ready' }],
      }),
      openchamberVersion: '1.0.0',
      runtimeName: 'test',
      express,
    });

    const response = await request(app)
      .get('/api/desktop/diagnostics/startup')
      .expect(200);

    expect(response.body).toEqual({
      bootId: 'boot-a',
      events: [{ name: 'electron.app.ready' }],
    });
  });

  it('should parse JSON bodies for snippet config routes', async () => {
    const app = express();
    registerCommonRequestMiddleware(app, { express });
    app.post('/api/config/snippets/example', (req, res) => {
      res.json({ body: req.body });
    });

    const response = await request(app)
      .post('/api/config/snippets/example')
      .send({ content: 'Snippet body' })
      .expect(200);

    expect(response.body).toEqual({ body: { content: 'Snippet body' } });
  });

  it('responds to manual config reload before the AX Code restart settles', async () => {
    const app = express();
    let resolveReload;
    const reloadPromise = new Promise((resolve) => {
      resolveReload = resolve;
    });
    const refreshAxCodeAfterConfigChange = vi.fn(() => reloadPromise);

    registerSettingsUtilityRoutes(app, {
      readCustomThemesFromDisk: vi.fn(async () => []),
      refreshAxCodeAfterConfigChange,
      clientReloadDelayMs: 25,
    });

    const response = await request(app)
      .post('/api/config/reload')
      .expect(200);

    expect(refreshAxCodeAfterConfigChange).toHaveBeenCalledWith('manual configuration reload', {
      readyTimeoutMs: 360000,
    });
    expect(response.body).toMatchObject({
      success: true,
      requiresReload: true,
      reloadInProgress: false,
      reloadDelayMs: 1500,
      reloadTimeoutMs: 360000,
    });

    resolveReload();
    await reloadPromise;
  });

  it('deduplicates overlapping manual config reload requests', async () => {
    const app = express();
    const resolveReloads = [];
    const reloadPromises = [];
    const refreshAxCodeAfterConfigChange = vi.fn(() => {
      const reloadPromise = new Promise((resolve) => {
        resolveReloads.push(resolve);
      });
      reloadPromises.push(reloadPromise);
      return reloadPromise;
    });

    registerSettingsUtilityRoutes(app, {
      readCustomThemesFromDisk: vi.fn(async () => []),
      refreshAxCodeAfterConfigChange,
      clientReloadDelayMs: 2000,
    });

    await request(app)
      .post('/api/config/reload')
      .expect(200)
      .expect((response) => {
        expect(response.body.reloadInProgress).toBe(false);
        expect(response.body.reloadDelayMs).toBe(2000);
      });

    await request(app)
      .post('/api/config/reload')
      .expect(200)
      .expect((response) => {
        expect(response.body.reloadInProgress).toBe(true);
      });

    expect(refreshAxCodeAfterConfigChange).toHaveBeenCalledTimes(1);

    resolveReloads[0]();
    await Promise.resolve();
    expect(refreshAxCodeAfterConfigChange).toHaveBeenCalledTimes(2);

    resolveReloads[1]();
    await reloadPromises[1];
  });

  it('should require API auth before probing loopback preview URLs', async () => {
    const app = express();
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    registerAuthAndAccessRoutes(app, {
      express,
      uiAuthController: {
        requireAuth: (_req, res) => res.status(401).json({ error: 'Unauthorized' }),
        handleSessionStatus: vi.fn(),
        handleSessionCreate: vi.fn(),
        handlePasskeyStatus: vi.fn(),
        handlePasskeyAuthenticationOptions: vi.fn(),
        handlePasskeyAuthenticationVerify: vi.fn(),
        handlePasskeyRegistrationOptions: vi.fn(),
        handlePasskeyRegistrationVerify: vi.fn(),
        handlePasskeyList: vi.fn(),
        handlePasskeyRevoke: vi.fn(),
        handleResetAuth: vi.fn(),
      },
    });

    try {
      await request(app)
        .post('/api/system/probe-url')
        .send({ url: 'http://127.0.0.1:5173/' })
        .expect(401);

      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
