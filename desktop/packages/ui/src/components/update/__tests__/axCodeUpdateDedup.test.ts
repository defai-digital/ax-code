import { describe, test, expect } from 'vitest';

import {
    resolveAxCodeIncompatibility,
    resolveAxCodeUpdateVersion,
    resolveAxCodeUpgradeStatusVersion,
    shouldShowAxCodeUpdateToast,
} from '../axCodeUpdateDedup';

describe('shouldShowAxCodeUpdateToast', () => {
    test('returns true for a fresh version with no dismissal and an empty seen set', () => {
        expect(
            shouldShowAxCodeUpdateToast({
                version: '1.16.0',
                dismissedVersion: null,
                seenVersions: new Set(),
            }),
        ).toBe(true);
    });

    test('returns false for an empty version string', () => {
        expect(
            shouldShowAxCodeUpdateToast({
                version: '',
                dismissedVersion: null,
                seenVersions: new Set(),
            }),
        ).toBe(false);
    });

    test('returns false when the version was already surfaced in this session', () => {
        expect(
            shouldShowAxCodeUpdateToast({
                version: '1.16.0',
                dismissedVersion: null,
                seenVersions: new Set(['1.16.0']),
            }),
        ).toBe(false);
    });

    test('returns false when the dismissed version matches the incoming version', () => {
        expect(
            shouldShowAxCodeUpdateToast({
                version: '1.16.0',
                dismissedVersion: '1.16.0',
                seenVersions: new Set(),
            }),
        ).toBe(false);
    });

    test('returns true when a different version was previously dismissed', () => {
        expect(
            shouldShowAxCodeUpdateToast({
                version: '1.17.0',
                dismissedVersion: '1.16.0',
                seenVersions: new Set(),
            }),
        ).toBe(true);
    });

    test('treats null dismissedVersion as no prior dismissal', () => {
        expect(
            shouldShowAxCodeUpdateToast({
                version: '1.16.0',
                dismissedVersion: null,
                seenVersions: new Set(['1.15.0']),
            }),
        ).toBe(true);
    });

    test('seen set blocks even when dismissed version differs', () => {
        expect(
            shouldShowAxCodeUpdateToast({
                version: '1.16.0',
                dismissedVersion: '1.15.0',
                seenVersions: new Set(['1.16.0']),
            }),
        ).toBe(false);
    });
});

describe('resolveAxCodeUpdateVersion', () => {
    test('returns the trimmed version when detail.version is a string', () => {
        expect(resolveAxCodeUpdateVersion({ version: '1.16.0' })).toBe('1.16.0');
    });

    test('trims surrounding whitespace from a string version', () => {
        expect(resolveAxCodeUpdateVersion({ version: '  1.16.0  ' })).toBe('1.16.0');
    });

    test('returns empty string when detail is null', () => {
        expect(resolveAxCodeUpdateVersion(null)).toBe('');
    });

    test('returns empty string when detail is undefined', () => {
        expect(resolveAxCodeUpdateVersion(undefined)).toBe('');
    });

    test('returns empty string when detail is not an object', () => {
        expect(resolveAxCodeUpdateVersion('1.16.0')).toBe('');
        expect(resolveAxCodeUpdateVersion(42)).toBe('');
        expect(resolveAxCodeUpdateVersion(true)).toBe('');
    });

    test('returns empty string when the version field is missing', () => {
        expect(resolveAxCodeUpdateVersion({})).toBe('');
    });

    test('returns empty string when the version field is non-string', () => {
        expect(resolveAxCodeUpdateVersion({ version: 116 })).toBe('');
        expect(resolveAxCodeUpdateVersion({ version: null })).toBe('');
        expect(resolveAxCodeUpdateVersion({ version: { major: 1 } })).toBe('');
    });
});

describe('resolveAxCodeUpgradeStatusVersion', () => {
    test('returns the trimmed latestVersion when available is true', () => {
        expect(
            resolveAxCodeUpgradeStatusVersion({
                available: true,
                latestVersion: '1.16.0',
            }),
        ).toBe('1.16.0');
    });

    test('trims surrounding whitespace from latestVersion', () => {
        expect(
            resolveAxCodeUpgradeStatusVersion({
                available: true,
                latestVersion: '  1.16.0  ',
            }),
        ).toBe('1.16.0');
    });

    test('returns empty string when status is null', () => {
        expect(resolveAxCodeUpgradeStatusVersion(null)).toBe('');
    });

    test('returns empty string when status is undefined', () => {
        expect(resolveAxCodeUpgradeStatusVersion(undefined)).toBe('');
    });

    test('returns empty string when available is false', () => {
        expect(
            resolveAxCodeUpgradeStatusVersion({
                available: false,
                latestVersion: '1.16.0',
            }),
        ).toBe('');
    });

    test('returns empty string when available is missing or null', () => {
        expect(
            resolveAxCodeUpgradeStatusVersion({
                latestVersion: '1.16.0',
            }),
        ).toBe('');
        expect(
            resolveAxCodeUpgradeStatusVersion({
                available: null,
                latestVersion: '1.16.0',
            }),
        ).toBe('');
    });

    test('returns empty string when latestVersion is missing', () => {
        expect(resolveAxCodeUpgradeStatusVersion({ available: true })).toBe('');
    });

    test('returns empty string when latestVersion is non-string', () => {
        expect(
            resolveAxCodeUpgradeStatusVersion({
                available: true,
                latestVersion: null,
            }),
        ).toBe('');
    });
});

describe('resolveAxCodeIncompatibility', () => {
    test('returns the report when the server flags an incompatible runtime', () => {
        expect(
            resolveAxCodeIncompatibility({
                compatible: false,
                currentVersion: '5.10.0',
                minSupportedVersion: '5.11.1',
            }),
        ).toEqual({ version: '5.10.0', minSupportedVersion: '5.11.1' });
    });

    test('returns null when the runtime is compatible or compatibility is unknown', () => {
        expect(
            resolveAxCodeIncompatibility({
                compatible: true,
                currentVersion: '5.12.0',
                minSupportedVersion: '5.11.1',
            }),
        ).toBeNull();
        expect(
            resolveAxCodeIncompatibility({
                compatible: null,
                currentVersion: null,
                minSupportedVersion: '5.11.1',
            }),
        ).toBeNull();
        expect(resolveAxCodeIncompatibility(null)).toBeNull();
        expect(resolveAxCodeIncompatibility(undefined)).toBeNull();
    });

    test('returns null when version strings are missing or empty', () => {
        expect(
            resolveAxCodeIncompatibility({
                compatible: false,
                currentVersion: '',
                minSupportedVersion: '5.11.1',
            }),
        ).toBeNull();
        expect(
            resolveAxCodeIncompatibility({
                compatible: false,
                currentVersion: '5.10.0',
            }),
        ).toBeNull();
    });
});
