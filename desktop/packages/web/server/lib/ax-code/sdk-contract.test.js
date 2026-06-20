/**
 * Contract guard for the workspace @ax-code/sdk.
 *
 * This app mirrors a few SDK 2.2.0 internals (the loopback-bind guard and the
 * headless handle shape patch in lifecycle.js). Keep these checks aligned with
 * the workspace SDK package exports and generated declaration output.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SDK_VERSION, createAgent } from '@ax-code/sdk';
import { startHeadlessBackend } from '@ax-code/sdk/headless';
import { createAxCodeClient as createAxCodeClientV2 } from '@ax-code/sdk/v2';
import { createAxCodeClient as createAxCodeClientV2Client } from '@ax-code/sdk/v2/client';
import { isSdkLoopbackHostname } from './lifecycle.js';

const sdkPackageRoot = resolve(dirname(fileURLToPath(import.meta.resolve('@ax-code/sdk'))), '..');
const sdkPackageJson = JSON.parse(readFileSync(resolve(sdkPackageRoot, 'package.json'), 'utf8'));
const headlessLifecycleTypes = readFileSync(resolve(sdkPackageRoot, 'dist/headless/lifecycle.d.ts'), 'utf8');

describe('workspace @ax-code/sdk contract', () => {
  it('loads the same SDK package version exposed by the runtime entry point', () => {
    expect(SDK_VERSION).toBe(sdkPackageJson.version);
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('exposes every entry point this app imports', () => {
    const exportsMap = sdkPackageJson.exports ?? {};
    for (const entry of ['.', './v2', './v2/client', './headless']) {
      expect(exportsMap[entry], `missing SDK export "${entry}"`).toBeDefined();
    }
    expect(typeof createAgent).toBe('function');
    expect(typeof createAxCodeClientV2).toBe('function');
    expect(typeof createAxCodeClientV2Client).toBe('function');
  });

  it('still provides startHeadlessBackend for the managed runtime', () => {
    expect(typeof startHeadlessBackend).toBe('function');
  });

  it('supports explicit binary/args and startup diagnostics for the managed runtime', () => {
    expect(headlessLifecycleTypes).toContain('binary?: string');
    expect(headlessLifecycleTypes).toContain('args?: string[]');
    expect(headlessLifecycleTypes).toContain('diagnostics: HeadlessBackendDiagnostics');
  });
});

describe('isSdkLoopbackHostname mirror', () => {
  // These fixtures must match the SDK's own loopback guard so that
  // allowNetworkBind is only set for explicitly non-loopback hostnames.
  it('treats loopback hostnames as loopback', () => {
    for (const hostname of ['localhost', 'LOCALHOST', '::1', '[::1]', '127.0.0.1', '127.5.5.5', '', undefined]) {
      expect(isSdkLoopbackHostname(hostname), `expected "${hostname}" to be loopback`).toBe(true);
    }
  });

  it('treats network hostnames as non-loopback', () => {
    for (const hostname of ['0.0.0.0', '192.168.1.10', '10.0.0.1', 'example.com', '128.0.0.1', '127.0.0']) {
      expect(isSdkLoopbackHostname(hostname), `expected "${hostname}" to be non-loopback`).toBe(false);
    }
  });
});
