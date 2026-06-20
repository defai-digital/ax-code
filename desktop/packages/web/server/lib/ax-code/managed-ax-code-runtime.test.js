import { describe, expect, it, vi } from 'vitest';

import { createManagedAxCodeRuntimeAdapter } from './managed-ax-code-runtime.js';

describe('managed ax-code runtime adapter', () => {
  it('wraps lifecycle operations behind a small adapter surface', async () => {
    const launchServerProcess = vi.fn(async () => ({ url: 'http://127.0.0.1:1234' }));
    const killPort = vi.fn();
    const waitForPortRelease = vi.fn(async () => true);
    const adapter = createManagedAxCodeRuntimeAdapter({
      launchServerProcess,
      probeProcessHealth: vi.fn(async () => true),
      probeExternalServer: vi.fn(async () => false),
      killPort,
      waitForPortRelease,
      isProcessAlive: vi.fn(() => true),
    });

    await expect(adapter.launchServerProcess({ port: 1234 })).resolves.toEqual({ url: 'http://127.0.0.1:1234' });
    await expect(adapter.releasePort(1234, 5000)).resolves.toBe(true);

    expect(launchServerProcess).toHaveBeenCalledWith({ port: 1234 });
    expect(killPort).toHaveBeenCalledWith(1234);
    expect(waitForPortRelease).toHaveBeenCalledWith(1234, 5000);
    expect(adapter.isProcessAlive()).toBe(true);
  });
});
