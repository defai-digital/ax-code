import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: vi.fn(async () => ({ challenge: 'auth-challenge' })),
  generateRegistrationOptions: vi.fn(async () => ({ challenge: 'registration-challenge' })),
  verifyAuthenticationResponse: vi.fn(async () => ({
    verified: true,
    authenticationInfo: { newCounter: 2 },
  })),
  verifyRegistrationResponse: vi.fn(async () => ({
    verified: true,
    registrationInfo: {
      credential: {
        id: 'credential-id',
        publicKey: Uint8Array.from([1, 2, 3]),
        counter: 1,
        transports: ['internal'],
      },
      credentialDeviceType: 'singleDevice',
      credentialBackedUp: false,
    },
  })),
}));

const simpleWebAuthn = await import('@simplewebauthn/server');
const { createUiPasskeys } = await import('./ui-passkeys.js');

const createRequest = ({ host, protocol = 'http' }) => ({
  headers: {
    host,
    ...(protocol ? { 'x-forwarded-proto': protocol } : {}),
  },
  hostname: host,
  socket: {
    encrypted: protocol === 'https',
  },
});

describe('ui passkeys', () => {
  let tempRoot;
  let storeFile;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ax-code-ui-passkeys-'));
    storeFile = path.join(tempRoot, 'ui-passkeys.json');
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('normalizes request origins before WebAuthn verification', async () => {
    const passkeys = createUiPasskeys({
      passwordBinding: 'password-binding',
      readSettingsFromDiskMigrated: async () => ({}),
      storeFile,
    });

    const registration = await passkeys.beginRegistration(createRequest({ host: 'LOCALHOST:3000' }));
    await passkeys.finishRegistration({
      requestId: registration.requestId,
      response: { id: 'credential-id' },
    });

    expect(simpleWebAuthn.verifyRegistrationResponse).toHaveBeenCalledWith(expect.objectContaining({
      expectedOrigin: ['http://localhost:3000'],
      expectedRPID: ['localhost'],
    }));
  });
});
