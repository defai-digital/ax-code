import { describe, expect, test } from 'vitest';

import {
  buildReport,
  buildVerdicts,
  formatReport,
  median,
  parseArgs,
  summarizeDecodeThroughput,
  summarizeStartupTimeline,
  summarizeStreams,
} from './ax-code-perf-report.mjs';

describe('median', () => {
  test('handles odd, even, and empty inputs', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(median([NaN, 5])).toBe(5);
  });
});

describe('summarizeStartupTimeline', () => {
  test('orders events and computes step deltas and milestones', () => {
    const { timeline, milestoneMs } = summarizeStartupTimeline([
      { name: 'web.server.ready', sinceStartMs: 900 },
      { name: 'web.server.bootstrap.start', sinceStartMs: 100 },
      { name: 'ax-code.process.launched', sinceStartMs: 400 },
      { name: 'custom.event', sinceStartMs: 500 },
    ]);

    expect(timeline.map((e) => e.name)).toEqual([
      'web.server.bootstrap.start',
      'ax-code.process.launched',
      'custom.event',
      'web.server.ready',
    ]);
    expect(timeline[1].stepMs).toBe(300);
    expect(timeline[2].key).toBe(false);
    expect(milestoneMs['ax-code.process.launched']).toBe(400);
    expect(milestoneMs['web.server.ready']).toBe(900);
  });

  test('tolerates missing or malformed events', () => {
    expect(summarizeStartupTimeline(undefined).timeline).toEqual([]);
    expect(summarizeStartupTimeline([{ sinceStartMs: 5 }, null]).timeline).toEqual([]);
  });
});

describe('summarizeStreams', () => {
  test('computes pipeline overhead per stream and aggregates', () => {
    const summary = summarizeStreams({
      totals: { started: 3, completed: 2, backpressureWaits: 1 },
      active: 1,
      recent: [
        { requestPath: '/event', firstChunkLatencyMs: 120, upstreamFirstChunkLatencyMs: 100, durationMs: 5000 },
        { requestPath: '/global/event', firstChunkLatencyMs: 80, upstreamFirstChunkLatencyMs: 70 },
        { requestPath: '/event', firstChunkLatencyMs: null, upstreamFirstChunkLatencyMs: null },
      ],
    });

    expect(summary.streams[0].pipelineOverheadMs).toBe(20);
    expect(summary.streams[1].pipelineOverheadMs).toBe(10);
    expect(summary.streams[2].pipelineOverheadMs).toBeNull();
    expect(summary.overhead.samples).toBe(2);
    expect(summary.overhead.medianMs).toBe(15);
    expect(summary.overhead.maxMs).toBe(20);
    expect(summary.activeStreams).toBe(1);
  });

  test('handles an empty snapshot', () => {
    const summary = summarizeStreams(undefined);
    expect(summary.streams).toEqual([]);
    expect(summary.overhead.samples).toBe(0);
    expect(summary.overhead.medianMs).toBeNull();
  });
});

describe('summarizeDecodeThroughput', () => {
  test('computes per-stream rates and averages', () => {
    const result = summarizeDecodeThroughput([
      { chunkCount: 100, totalBytes: 5000, durationMs: 2000, requestPath: '/event' },
      { chunkCount: 50, totalBytes: 2500, durationMs: 1000, requestPath: '/event' },
    ]);
    expect(result.streams).toHaveLength(2);
    expect(result.streams[0].chunksPerSecond).toBe(50);
    expect(result.streams[0].bytesPerSecond).toBe(2500);
    expect(result.streams[1].chunksPerSecond).toBe(50);
    expect(result.avgChunksPerSecond).toBe(50);
    expect(result.avgBytesPerSecond).toBe(2500);
  });

  test('filters out streams below minimum thresholds', () => {
    const result = summarizeDecodeThroughput([
      { chunkCount: 5, totalBytes: 100, durationMs: 200, requestPath: '/event' },
      { chunkCount: 100, totalBytes: 5000, durationMs: 2000, requestPath: '/event' },
    ]);
    expect(result.streams).toHaveLength(1);
    expect(result.streams[0].chunkCount).toBe(100);
  });

  test('returns null averages when no streams qualify', () => {
    const result = summarizeDecodeThroughput([
      { chunkCount: 2, totalBytes: 50, durationMs: 100 },
    ]);
    expect(result.streams).toHaveLength(0);
    expect(result.avgChunksPerSecond).toBeNull();
    expect(result.avgBytesPerSecond).toBeNull();
  });

  test('handles empty input', () => {
    const result = summarizeDecodeThroughput([]);
    expect(result.streams).toHaveLength(0);
    expect(result.avgChunksPerSecond).toBeNull();
  });
});

describe('buildVerdicts', () => {
  test('declares the pipeline not the bottleneck under the threshold', () => {
    const verdicts = buildVerdicts({
      streaming: { overhead: { samples: 4, medianMs: 12, maxMs: 30 }, totals: {} },
      startup: { milestoneMs: {} },
    });
    expect(verdicts.some((v) => v.includes('NOT the bottleneck'))).toBe(true);
    expect(verdicts.some((v) => v.includes('gRPC'))).toBe(true);
  });

  test('flags low decode throughput as backend bottleneck', () => {
    const verdicts = buildVerdicts({
      streaming: { overhead: { samples: 2, medianMs: 10, maxMs: 15 }, totals: {} },
      startup: {},
      decodeThroughput: {
        streams: [{ chunkCount: 20, durationMs: 2000 }],
        avgChunksPerSecond: 10,
        avgBytesPerSecond: 500,
      },
    });
    expect(verdicts.some((v) => v.includes('decode throughput is 10.0 chunks/s'))).toBe(true);
    expect(verdicts.some((v) => v.includes('backend inference engine is the bottleneck'))).toBe(true);
  });

  test('reports good throughput when rate is high and overhead low', () => {
    const verdicts = buildVerdicts({
      streaming: { overhead: { samples: 2, medianMs: 10, maxMs: 15 }, totals: {} },
      startup: {},
      decodeThroughput: {
        streams: [{ chunkCount: 200, durationMs: 2000 }],
        avgChunksPerSecond: 100,
        avgBytesPerSecond: 5000,
      },
    });
    expect(verdicts.some((v) => v.includes('delivering tokens as fast as the backend produces'))).toBe(true);
  });

  test('notes insufficient data when streams exist but lack throughput data', () => {
    const verdicts = buildVerdicts({
      streaming: { overhead: { samples: 3, medianMs: 10, maxMs: 20 }, totals: {} },
      startup: {},
      decodeThroughput: { streams: [], avgChunksPerSecond: null, avgBytesPerSecond: null },
    });
    expect(verdicts.some((v) => v.includes('No streams had enough chunks/duration'))).toBe(true);
  });

  test('flags slow pipeline, backpressure, version, and startup issues', () => {
    const verdicts = buildVerdicts({
      health: {
        axCodeVersionCompatibility: { compatible: false, version: '5.10.0', minSupportedVersion: '5.11.1' },
      },
      startup: { milestoneMs: { 'ax-code.process.launched': 1000, 'web.server.ready': 20000 } },
      streaming: {
        overhead: { samples: 2, medianMs: 400, maxMs: 900 },
        totals: { backpressureWaits: 7, upstreamErrors: 2 },
      },
    });

    expect(verdicts.some((v) => v.includes('below the minimum supported'))).toBe(true);
    expect(verdicts.some((v) => v.includes('Backend startup took'))).toBe(true);
    expect(verdicts.some((v) => v.includes('investigate the proxy path'))).toBe(true);
    expect(verdicts.some((v) => v.includes('backpressure wait'))).toBe(true);
    expect(verdicts.some((v) => v.includes('upstream stream error'))).toBe(true);
  });

  test('asks for a session when no streams are recorded', () => {
    const verdicts = buildVerdicts({ streaming: { overhead: { samples: 0 }, totals: {} }, startup: {} });
    expect(verdicts.some((v) => v.includes('No completed SSE streams'))).toBe(true);
  });

  test('flags provider/index warmup when runtime readiness is not ready', () => {
    const verdicts = buildVerdicts({
      health: {
        axCodeRuntimeHealth: {
          readiness: { processAlive: true, apiReady: true, providersReady: 'unknown', indexReady: 'degraded' },
        },
      },
      startup: {},
      streaming: { overhead: { samples: 1, medianMs: 5, maxMs: 5 }, totals: {} },
    });
    expect(verdicts.some((v) => v.includes('providersReady=unknown'))).toBe(true);
    expect(verdicts.some((v) => v.includes('indexReady=degraded'))).toBe(true);
  });

  test('does not flag warmup when readiness is ready or absent', () => {
    const ready = buildVerdicts({
      health: { axCodeRuntimeHealth: { readiness: { providersReady: 'ready', indexReady: 'ready' } } },
      startup: {},
      streaming: { overhead: { samples: 1, medianMs: 5, maxMs: 5 }, totals: {} },
    });
    expect(ready.some((v) => v.includes('not fully warm'))).toBe(false);

    const absent = buildVerdicts({
      health: {},
      startup: {},
      streaming: { overhead: { samples: 1, medianMs: 5, maxMs: 5 }, totals: {} },
    });
    expect(absent.some((v) => v.includes('not fully warm'))).toBe(false);
  });
});

describe('buildReport + formatReport', () => {
  test('produces a readable report from raw endpoint payloads', () => {
    const report = buildReport({
      health: {
        axCodeRunning: true,
        isAxCodeReady: true,
        axCodeVersion: '5.12.1',
        axCodeVersionCompatibility: { compatible: true, version: '5.12.1', minSupportedVersion: '5.11.1' },
      },
      diagnostics: {
        bootId: 'boot-1',
        events: [
          { name: 'web.server.bootstrap.start', sinceStartMs: 0 },
          { name: 'ax-code.process.launched', sinceStartMs: 350 },
          { name: 'web.server.ready', sinceStartMs: 1200 },
          {
            name: 'stream.first_token',
            sinceStartMs: 4000,
            details: { firstChunkLatencyMs: 90, upstreamFirstChunkLatencyMs: 80 },
          },
        ],
        sseProxy: {
          totals: { started: 1, completed: 1, backpressureWaits: 0 },
          active: 0,
          recent: [
            { requestPath: '/event', firstChunkLatencyMs: 90, upstreamFirstChunkLatencyMs: 80, durationMs: 3000, reason: 'complete' },
          ],
        },
      },
    });

    expect(report.streaming.overhead.medianMs).toBe(10);
    expect(report.verdicts.some((v) => v.includes('NOT the bottleneck'))).toBe(true);

    const text = formatReport(report);
    expect(text).toContain('Performance Diagnostics Report');
    expect(text).toContain('5.12.1');
    expect(text).toContain('stream.first_token');
    expect(text).toContain('median 10ms');
    expect(text).toContain('## Verdicts');
    expect(text).toContain('## Decode throughput');
  });
});

describe('parseArgs', () => {
  test('parses url, port, and json flags', () => {
    expect(parseArgs([])).toEqual({ baseUrl: 'http://localhost:3000', json: false });
    expect(parseArgs(['--url', 'http://localhost:9999/'])).toEqual({ baseUrl: 'http://localhost:9999', json: false });
    expect(parseArgs(['--port', '4567', '--json'])).toEqual({ baseUrl: 'http://localhost:4567', json: true });
  });
});
