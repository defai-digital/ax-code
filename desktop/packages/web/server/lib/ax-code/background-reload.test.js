import { describe, expect, it, vi } from 'vitest';
import { createBackgroundAxCodeReloader } from './background-reload.js';

describe('background AX Code reload helper', () => {
  it('deduplicates reload requests while a restart is in flight', async () => {
    let resolveReload;
    const reloadPromise = new Promise((resolve) => {
      resolveReload = resolve;
    });
    const refreshAxCodeAfterConfigChange = vi.fn(() => reloadPromise);
    const reloader = createBackgroundAxCodeReloader({
      refreshAxCodeAfterConfigChange,
      clientReloadDelayMs: 25,
    });

    const first = reloader.start('first reload');
    const second = reloader.start('second reload');
    await Promise.resolve();

    expect(first).toEqual({
      alreadyRunning: false,
      reloadDelayMs: 1500,
      reloadTimeoutMs: 360000,
    });
    expect(second).toEqual({
      alreadyRunning: true,
      reloadDelayMs: 1500,
      reloadTimeoutMs: 360000,
    });
    expect(refreshAxCodeAfterConfigChange).toHaveBeenCalledTimes(1);
    expect(refreshAxCodeAfterConfigChange).toHaveBeenCalledWith('first reload', {
      readyTimeoutMs: 360000,
    });

    resolveReload();
    await reloadPromise;
  });

  it('runs one follow-up reload when a new request arrives during a restart', async () => {
    let resolveFirstReload;
    const firstReload = new Promise((resolve) => {
      resolveFirstReload = resolve;
    });
    let resolveSecondReload;
    const secondReload = new Promise((resolve) => {
      resolveSecondReload = resolve;
    });
    const refreshAxCodeAfterConfigChange = vi
      .fn()
      .mockReturnValueOnce(firstReload)
      .mockReturnValueOnce(secondReload);
    const reloader = createBackgroundAxCodeReloader({
      refreshAxCodeAfterConfigChange,
      clientReloadDelayMs: 25,
    });

    reloader.start('first reload');
    const second = reloader.start('second reload');
    const third = reloader.start('third reload');
    await Promise.resolve();

    expect(second.alreadyRunning).toBe(true);
    expect(third.alreadyRunning).toBe(true);
    expect(refreshAxCodeAfterConfigChange).toHaveBeenCalledTimes(1);

    resolveFirstReload();
    await Promise.resolve();

    expect(refreshAxCodeAfterConfigChange).toHaveBeenCalledTimes(2);
    expect(refreshAxCodeAfterConfigChange).toHaveBeenLastCalledWith('third reload', {
      readyTimeoutMs: 360000,
    });

    resolveSecondReload();
    await secondReload;
  });
});
