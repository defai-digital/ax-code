import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGlobalMessageStreamHub } from '../event-stream/global-hub.js';
import { createSseResponse } from '../event-stream/test-helpers.js';
import { createAxCodeWatcherRuntime } from './watcher.js';

describe('createAxCodeWatcherRuntime', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('waits for ax-code readiness and forwards unwrapped global SSE payloads', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const payloads = [];
    const fetchCalls = [];

    const watcher = createAxCodeWatcherRuntime({
      waitForAxCodePort: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
      },
      buildAxCodeUrl: (path) => `http://127.0.0.1:4096${path}`,
      getAxCodeAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
      onPayload(payload) {
        payloads.push(payload);
        watcher.stop();
      },
      fetchImpl: async (url, options) => {
        fetchCalls.push({ url, headers: options.headers });
        return createSseResponse({
          signal: options.signal,
          blocks: [
            'id: evt-1\ndata: {"directory":"/tmp/project","payload":{"type":"session.updated","properties":{"sessionID":"ses_1"}}}\n\n',
          ],
        });
      },
    });

    await watcher.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fetchCalls).toEqual([
      {
        url: 'http://127.0.0.1:4096/global/event',
        headers: {
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          Authorization: 'Bearer test-token',
        },
      },
    ]);
    expect(payloads).toEqual([
      {
        type: 'session.updated',
        properties: {
          sessionID: 'ses_1',
        },
      },
    ]);
  });

  it('resumes watcher reconnects with Last-Event-ID after a stalled upstream stream', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchLastEventIds = [];
    const payloads = [];
    let attempt = 0;

    const watcher = createAxCodeWatcherRuntime({
      waitForAxCodePort: async () => {},
      buildAxCodeUrl: (path) => `http://127.0.0.1:4096${path}`,
      getAxCodeAuthHeaders: () => ({}),
      onPayload(payload) {
        payloads.push(payload.type);
        if (payload.type === 'session.updated') {
          watcher.stop();
        }
      },
      fetchImpl: async (_url, options) => {
        fetchLastEventIds.push(options.headers['Last-Event-ID'] ?? null);
        attempt += 1;

        if (attempt === 1) {
          return createSseResponse({
            signal: options.signal,
            holdOpen: true,
            blocks: [
              'id: evt-1\ndata: {"type":"server.connected","properties":{}}\n\n',
            ],
          });
        }

        return createSseResponse({
          signal: options.signal,
          blocks: [
            'id: evt-2\ndata: {"type":"session.updated","properties":{}}\n\n',
          ],
        });
      },
      upstreamStallTimeoutMs: 10,
      upstreamReconnectDelayMs: 0,
    });

    await watcher.start();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(payloads).toEqual(['server.connected', 'session.updated']);
    expect(fetchLastEventIds.slice(0, 2)).toEqual([null, 'evt-1']);
  });

  it('subscribes to a shared global event hub instead of opening its own upstream stream', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const payloads = [];
    let hubFetchCalls = 0;
    let watcherFetchCalls = 0;

    const globalEventHub = createGlobalMessageStreamHub({
      buildAxCodeUrl: (path) => `http://127.0.0.1:4096${path}`,
      getAxCodeAuthHeaders: () => ({}),
      upstreamReconnectDelayMs: 0,
      fetchImpl: async (_url, options) => {
        hubFetchCalls += 1;
        return createSseResponse({
          signal: options.signal,
          holdOpen: true,
          blocks: [
            'id: evt-1\ndata: {"payload":{"type":"session.updated","properties":{"sessionID":"ses_1"}}}\n\n',
          ],
        });
      },
    });

    const watcher = createAxCodeWatcherRuntime({
      waitForAxCodePort: async () => {},
      buildAxCodeUrl: (path) => `http://127.0.0.1:4096${path}`,
      getAxCodeAuthHeaders: () => ({}),
      globalEventHub,
      onPayload(payload) {
        payloads.push(payload);
        watcher.stop();
      },
      fetchImpl: async () => {
        watcherFetchCalls += 1;
        throw new Error('watcher fetch should not be called');
      },
    });

    await watcher.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(hubFetchCalls).toBe(1);
    expect(watcherFetchCalls).toBe(0);
    expect(payloads).toEqual([
      {
        type: 'session.updated',
        properties: {
          sessionID: 'ses_1',
        },
      },
    ]);
  });

  it('does not stop a shared global event hub when the watcher stops', async () => {
    const events = new Set();
    const statuses = new Set();
    let startCalls = 0;
    let stopCalls = 0;

    const globalEventHub = {
      start() {
        startCalls += 1;
      },
      stop() {
        stopCalls += 1;
      },
      subscribeEvent(subscriber) {
        events.add(subscriber);
        return () => {
          events.delete(subscriber);
        };
      },
      subscribeStatus(subscriber) {
        statuses.add(subscriber);
        return () => {
          statuses.delete(subscriber);
        };
      },
    };

    const watcher = createAxCodeWatcherRuntime({
      waitForAxCodePort: async () => {},
      buildAxCodeUrl: (path) => `http://127.0.0.1:4096${path}`,
      getAxCodeAuthHeaders: () => ({}),
      globalEventHub,
      onPayload() {},
    });

    await watcher.start();
    watcher.stop();

    expect(startCalls).toBe(1);
    expect(stopCalls).toBe(0);
    expect(events.size).toBe(0);
    expect(statuses.size).toBe(0);
  });
});
