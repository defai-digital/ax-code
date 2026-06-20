import { createBackgroundAxCodeReloader } from './background-reload.js';

const parseLoopbackUrl = (rawUrl) => {
  if (typeof rawUrl !== 'string') {
    return null;
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }

  const host = url.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && host !== '0.0.0.0') {
    return null;
  }

  return url;
};

export const registerServerStatusRoutes = (app, dependencies) => {
  const {
    express,
    process,
    openchamberVersion,
    runtimeName,
    serverStartedAt,
    gracefulShutdown,
    getHealthSnapshot,
    getStartupDiagnosticsSnapshot = null,
    uiAuthController = null,
  } = dependencies;

  const allocateLoopbackPort = async () => {
    const net = await import('node:net');
    return await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        try {
          const address = server.address();
          const port = address && typeof address === 'object' ? address.port : 0;
          server.close(() => {
            resolve(port);
          });
        } catch (error) {
          try {
            server.close();
          } catch {
          }
          reject(error);
        }
      });
    });
  };

  const isDevShutdownAllowed = () => {
    // Dev-only escape hatch: allow terminating the whole dev process group.
    // This should never be enabled in production runtimes.
    return process.env.AX_CODE_DESKTOP_DEV_SHUTDOWN === 'true';
  };

  const isSameOriginRequest = (req) => {
    const rawOrigin = typeof req.get === 'function' ? req.get('origin') : '';
    const rawHost = typeof req.get === 'function' ? req.get('host') : '';
    if (!rawOrigin || !rawHost) {
      return false;
    }
    try {
      const origin = new URL(rawOrigin);
      return origin.host === rawHost;
    } catch {
      return false;
    }
  };

  const resolveProcessGroupId = async (pid) => {
    if (!pid || typeof pid !== 'number' || !Number.isFinite(pid) || pid <= 0) {
      return null;
    }
    if (process.platform === 'win32') {
      return null;
    }

    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);
      const result = await execFileAsync('ps', ['-o', 'pgid=', '-p', String(pid)]);
      const raw = String(result.stdout || '').trim();
      const pgid = Number.parseInt(raw, 10);
      return Number.isFinite(pgid) && pgid > 0 ? pgid : null;
    } catch {
      return null;
    }
  };

  const parseLoopbackPort = (rawUrl) => {
    if (typeof rawUrl !== 'string') {
      return null;
    }
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    const host = url.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && host !== '0.0.0.0') {
      return null;
    }
    const port = url.port ? Number.parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      return null;
    }
    return port;
  };

  const killListenPort = async (port) => {
    if (!Number.isFinite(port) || port <= 0) {
      return;
    }
    if (process.platform === 'win32') {
      return;
    }

    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);
      const result = await execFileAsync('lsof', ['-nP', '-t', `-iTCP:${Math.trunc(port)}`, '-sTCP:LISTEN'], {
        timeout: 2500,
      });
      const pids = String(result.stdout || '')
        .split(/\s+/)
        .map((value) => Number.parseInt(value, 10))
        .filter((pid) => Number.isFinite(pid) && pid > 0 && pid !== process.pid);

      for (const pid of pids) {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
        }
      }
      if (pids.length > 0) {
        setTimeout(() => {
          for (const pid of pids) {
            try {
              process.kill(pid, 'SIGKILL');
            } catch {
            }
          }
        }, 1200).unref?.();
      }
    } catch {
      // ignore (no lsof, no permission, etc.)
    }
  };

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      ...getHealthSnapshot(),
    });
  });

  app.get('/api/desktop/diagnostics/startup', (_req, res) => {
    if (typeof getStartupDiagnosticsSnapshot !== 'function') {
      return res.status(404).json({ error: 'Startup diagnostics are not available' });
    }

    return res.json(getStartupDiagnosticsSnapshot());
  });

  app.post('/api/system/shutdown', async (req, res, next) => {
    try {
      if (uiAuthController) {
        await uiAuthController.requireAuth(req, res, () => {
          res.json({ ok: true });
          gracefulShutdown({ exitProcess: true }).catch((error) => {
            console.error('Shutdown request failed:', error?.message || error);
          });
        });
      } else {
        res.json({ ok: true });
        gracefulShutdown({ exitProcess: true }).catch((error) => {
          console.error('Shutdown request failed:', error?.message || error);
        });
      }
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/system/dev-shutdown', express.json({ limit: '64kb' }), async (req, res) => {
    if (!isDevShutdownAllowed()) {
      return res.status(403).json({ ok: false, error: 'Dev shutdown is disabled' });
    }
    if (!isSameOriginRequest(req)) {
      return res.status(403).json({ ok: false, error: 'Invalid origin' });
    }

    res.json({ ok: true });

    // Terminate the entire dev process group so `pnpm run dev` leaves no orphans.
    // We still run graceful shutdown to clean up ax-code, terminals, websockets.
    try {
      const rawPreviewUrls = Array.isArray(req.body?.previewUrls) ? req.body.previewUrls : [];
      const previewPorts = Array.from(new Set(
        rawPreviewUrls
          .map((value) => parseLoopbackPort(value))
          .filter((port) => typeof port === 'number')
      ));
      // Attempt to stop preview servers that may have daemonized away from the PTY.
      // This is dev-only and limited to loopback ports supplied by the UI.
      await Promise.all(previewPorts.map((port) => killListenPort(port)));

      const pgid = await resolveProcessGroupId(process.pid);
      const ppid = typeof process.ppid === 'number' ? process.ppid : null;
      const parentPgid = ppid ? await resolveProcessGroupId(ppid) : null;

      // Kick off shutdown cleanup first.
      void gracefulShutdown({ exitProcess: false });

      const pgidsToKill = Array.from(new Set([pgid, parentPgid].filter(Boolean)));
      for (const id of pgidsToKill) {
        try {
          process.kill(-id, 'SIGTERM');
        } catch {
        }
      }

      setTimeout(() => {
        for (const id of pgidsToKill) {
          try {
            process.kill(-id, 'SIGKILL');
          } catch {
          }
        }
      }, 1500).unref?.();

      // Ensure the server process itself exits even if the group kill fails.
      setTimeout(() => {
        try {
          process.exit(0);
        } catch {
        }
      }, 2500).unref?.();
    } catch (error) {
      console.error('Dev shutdown request failed:', error?.message || error);
      // As a last resort, exit.
      try {
        process.exit(0);
      } catch {
      }
    }
  });

  app.get('/api/system/info', (_req, res) => {
    res.json({
      openchamberVersion,
      runtime: runtimeName,
      pid: process.pid,
      startedAt: serverStartedAt,
    });
  });

  // Allocates a best-effort free TCP port hint on 127.0.0.1.
  // Another process can still claim it before the preview server binds.
  app.get('/api/system/free-port', async (_req, res) => {
    try {
      const port = await allocateLoopbackPort();
      if (!Number.isFinite(port) || port <= 0) {
        return res.status(500).json({ error: 'Failed to allocate port' });
      }
      return res.json({ port });
    } catch (error) {
      return res.status(500).json({ error: (error && error.message) || 'Failed to allocate port' });
    }
  });

};

export const registerAuthAndAccessRoutes = (app, dependencies) => {
  const {
    express,
    uiAuthController,
  } = dependencies;

  const requireApiAuth = (req, res, next) => uiAuthController.requireAuth(req, res, next);

  app.get('/auth/session', async (req, res) => {
    try {
      await uiAuthController.handleSessionStatus(req, res);
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/auth/session', (req, res) => {
    return uiAuthController.handleSessionCreate(req, res);
  });

  app.get('/auth/passkey/status', (req, res) => {
    return uiAuthController.handlePasskeyStatus(req, res);
  });

  app.post('/auth/passkey/authenticate/options', (req, res) => {
    return uiAuthController.handlePasskeyAuthenticationOptions(req, res);
  });

  app.post('/auth/passkey/authenticate/verify', (req, res) => {
    return uiAuthController.handlePasskeyAuthenticationVerify(req, res);
  });

  app.post('/auth/passkey/register/options', async (req, res, next) => {
    try {
      await uiAuthController.requireAuth(req, res, async () => {
        await uiAuthController.handlePasskeyRegistrationOptions(req, res);
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/auth/passkey/register/verify', async (req, res, next) => {
    try {
      await uiAuthController.requireAuth(req, res, async () => {
        await uiAuthController.handlePasskeyRegistrationVerify(req, res);
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/passkeys', async (req, res, next) => {
    try {
      await uiAuthController.requireAuth(req, res, async () => {
        await uiAuthController.handlePasskeyList(req, res);
      });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/passkeys/:id', async (req, res, next) => {
    try {
      await uiAuthController.requireAuth(req, res, async () => {
        await uiAuthController.handlePasskeyRevoke(req, res);
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/reset', async (req, res, next) => {
    try {
      await uiAuthController.requireAuth(req, res, async () => {
        await uiAuthController.handleResetAuth(req, res);
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/system/probe-url', express.json({ limit: '16kb' }), async (req, res, next) => {
    try {
      await requireApiAuth(req, res, async () => {
        const url = parseLoopbackUrl(req.body?.url);
        if (!url) {
          return res.status(400).json({ ok: false, error: 'Invalid loopback URL' });
        }

        try {
          const response = await fetch(url.toString(), {
            method: 'GET',
            redirect: 'manual',
            signal: AbortSignal.timeout(1500),
          });
          response.body?.cancel();
          return res.json({ ok: response.ok, status: response.status });
        } catch (error) {
          return res.json({ ok: false, error: error?.message || 'Probe failed' });
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.use('/api', async (req, res, next) => {
    try {
      await requireApiAuth(req, res, next);
    } catch (err) {
      next(err);
    }
  });
};

export const registerSettingsUtilityRoutes = (app, dependencies) => {
  const {
    readCustomThemesFromDisk,
    refreshAxCodeAfterConfigChange,
    clientReloadDelayMs,
    backgroundAxCodeReloader,
  } = dependencies;
  const axCodeReloader = backgroundAxCodeReloader ?? createBackgroundAxCodeReloader({
    refreshAxCodeAfterConfigChange,
    clientReloadDelayMs,
  });

  app.get('/api/config/themes', async (_req, res) => {
    try {
      const customThemes = await readCustomThemesFromDisk();
      res.json({ themes: customThemes });
    } catch (error) {
      console.error('Failed to load custom themes:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load custom themes' });
    }
  });

  app.post('/api/config/reload', (_req, res) => {
    console.log('[Server] Manual configuration reload requested');
    const reload = axCodeReloader.start('manual configuration reload');

    res.json({
      success: true,
      requiresReload: true,
      reloadInProgress: reload.alreadyRunning,
      message: reload.alreadyRunning
        ? 'AX Code is already restarting. Waiting for it to become ready…'
        : 'AX Code is restarting. This can take a few minutes…',
      reloadDelayMs: reload.reloadDelayMs,
      reloadTimeoutMs: reload.reloadTimeoutMs,
    });
  });
};

export const registerCommonRequestMiddleware = (app, dependencies) => {
  const { express, verboseRequestLogs = false } = dependencies;

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/behavior')) {
      const contentLength = parseInt(req.headers['content-length'] || '0', 10);
      if (contentLength > 1024 * 1024) {
        return res.status(413).json({ error: 'Content exceeds maximum size of 1048576 bytes' });
      }
      express.json({ limit: '1mb' })(req, res, next);
    } else if (
      req.path.startsWith('/api/config/agents') ||
      req.path.startsWith('/api/config/commands') ||
      req.path.startsWith('/api/config/mcp') ||
      req.path.startsWith('/api/config/snippets') ||
      req.path.startsWith('/api/config/settings') ||
      req.path.startsWith('/api/config/skills') ||
      req.path.startsWith('/api/config/plugins') ||
      req.path.startsWith('/api/projects') ||
      req.path.startsWith('/api/fs') ||
      req.path.startsWith('/api/git') ||
      req.path.startsWith('/api/magic-prompts') ||
      req.path.startsWith('/api/prompts') ||
      req.path.startsWith('/api/terminal') ||
      req.path.startsWith('/api/ax-code') ||
      req.path.startsWith('/api/notifications') ||
      req.path.startsWith('/api/session-folders') ||
      req.path.startsWith('/api/text')
    ) {
      express.json({ limit: '50mb' })(req, res, next);
    } else if (req.path.startsWith('/api')) {
      next();
    } else {
      express.json({ limit: '50mb' })(req, res, next);
    }
  });

  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  app.use((req, _res, next) => {
    if (verboseRequestLogs) {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    }
    next();
  });
};
