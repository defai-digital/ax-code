import { isRecord } from "@/util/record"
import { groupBySession, mergeSorted } from "./sync-util"

export function mergeBootstrapSessions<T extends { id: string }>(existing: T[], fetched: T[]) {
  return mergeSorted(existing, fetched)
}

export function normalizeBootstrapList<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : []
}

export function normalizeBootstrapRecord<T extends Record<string, unknown>>(data: unknown) {
  return isRecord(data) ? (data as T) : ({} as T)
}

export function normalizeBootstrapValue<T>(data: T | null | undefined, fallback: T) {
  return data ?? fallback
}

function isSessionScopedRecord(input: unknown): input is { sessionID: string } {
  return isRecord(input) && typeof input.sessionID === "string" && input.sessionID.length > 0
}

export function normalizeBootstrapSessionBuckets<T extends { sessionID: string }>(data: unknown) {
  const items = Array.isArray(data) ? (data.filter(isSessionScopedRecord) as T[]) : []
  return groupBySession(items)
}

export function createProviderBootstrapSuccess<T>(providers: { providers: T[]; default: Record<string, string> }) {
  return {
    provider: providers.providers,
    provider_default: providers.default,
    provider_loaded: true,
    provider_failed: false,
  } as const
}

export function createProviderBootstrapFailure() {
  return {
    provider_loaded: true,
    provider_failed: true,
  } as const
}

export type ProviderBootstrapState<T> =
  | ReturnType<typeof createProviderBootstrapSuccess<T>>
  | ReturnType<typeof createProviderBootstrapFailure>

export function applyProviderBootstrapState<T>(
  store: {
    provider: T[]
    provider_default: Record<string, string>
    provider_loaded: boolean
    provider_failed: boolean
  },
  next: ProviderBootstrapState<T>,
) {
  store.provider_loaded = next.provider_loaded
  store.provider_failed = next.provider_failed

  if ("provider" in next) {
    store.provider = next.provider
    store.provider_default = next.provider_default
  }
}
