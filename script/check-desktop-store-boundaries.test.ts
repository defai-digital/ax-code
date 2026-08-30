import path from "node:path"
import { describe, expect, test } from "vitest"
import {
  EVENT_TRANSPORT_CLIENT_CONSUMERS,
  STORE_TO_STORE_IMPORT_ALLOWLIST,
  analyzeEventTransportClientImports,
  analyzeStoreToStoreImports,
  analyzeSyncInternalImports,
  collectDesktopStoreBoundaryViolations,
  collectExportedHookNames,
  findDuplicateHookNames,
  resolveUiModule,
} from "./check-desktop-store-boundaries"

const root = path.resolve(import.meta.dirname, "..")
const uiSrc = path.join(root, "desktop/packages/ui/src")
const storeFile = (...segments: string[]) => path.join(uiSrc, "stores", ...segments)
const syncFile = (...segments: string[]) => path.join(uiSrc, "sync", ...segments)
const componentFile = (...segments: string[]) => path.join(uiSrc, "components", ...segments)

describe("resolveUiModule", () => {
  test("resolves the @/ alias and relative specifiers into ui/src", () => {
    expect(resolveUiModule(storeFile("useConfigStore-impl.ts"), "@/stores/useDirectoryStore")).toBe(
      "desktop/packages/ui/src/stores/useDirectoryStore",
    )
    expect(resolveUiModule(storeFile("useProjectsStore.ts"), "./useDirectoryStore")).toBe(
      "desktop/packages/ui/src/stores/useDirectoryStore",
    )
  })

  test("ignores cross-package and external specifiers", () => {
    expect(resolveUiModule(storeFile("useProjectsStore.ts"), "zustand")).toBeUndefined()
    expect(resolveUiModule(storeFile("useProjectsStore.ts"), "@openchamber/ui/main")).toBeUndefined()
    expect(resolveUiModule(syncFile("event-pipeline.ts"), "../../../web/src/x")).toBeUndefined()
  })
})

describe("R1 store-to-store import ratchet", () => {
  test("reports a new store-to-store edge", () => {
    const edges = analyzeStoreToStoreImports(storeFile("useFooStore.ts"), 'import { useBarStore } from "./useBarStore"')

    expect(edges).toHaveLength(1)
    expect(edges[0].edge).toBe("useFooStore -> useBarStore")
    expect(STORE_TO_STORE_IMPORT_ALLOWLIST).not.toContain("useFooStore -> useBarStore")
  })

  test("accepts the frozen baseline edges via relative and alias specifiers", () => {
    const relative = analyzeStoreToStoreImports(
      storeFile("useConfigStore-impl.ts"),
      'import { filterVisibleAgents } from "./useAgentsStore"',
    )
    const alias = analyzeStoreToStoreImports(
      storeFile("useAgentsStore.ts"),
      'import { useConfigStore } from "@/stores/useConfigStore"',
    )

    expect(relative.map((edge) => edge.edge)).toEqual(["useConfigStore-impl -> useAgentsStore"])
    expect(alias.map((edge) => edge.edge)).toEqual(["useAgentsStore -> useConfigStore"])
    expect(STORE_TO_STORE_IMPORT_ALLOWLIST).toContain("useConfigStore-impl -> useAgentsStore")
    expect(STORE_TO_STORE_IMPORT_ALLOWLIST).toContain("useAgentsStore -> useConfigStore")
  })

  test("ignores test files, nested support directories, and non-store imports", () => {
    expect(analyzeStoreToStoreImports(storeFile("useFooStore.test.ts"), 'import "./useBarStore"')).toEqual([])
    expect(analyzeStoreToStoreImports(storeFile("utils", "helper.ts"), 'import "../useBarStore"')).toEqual([])
    expect(
      analyzeStoreToStoreImports(
        storeFile("useFooStore.ts"),
        ['import { getSafeStorage } from "./utils/safeStorage"', 'import { create } from "zustand"'].join("\n"),
      ),
    ).toEqual([])
  })
})

describe("R2 sync internals encapsulation", () => {
  test("blocks external imports of sync internals", () => {
    const source = [
      'import { applyDirectoryEvent } from "@/sync/event-reducer"',
      'import { ChildStoreManager } from "../../sync/child-store"',
    ].join("\n")

    const violations = analyzeSyncInternalImports(componentFile("chat", "Widget.tsx"), source)
    expect(violations).toHaveLength(2)
    expect(violations.every((item) => item.rule === "R2")).toBe(true)
  })

  test("allows the documented public surface and sync-internal consumers", () => {
    const source = [
      'import { getSyncSessions } from "@/sync/sync-refs"',
      'import { useSessions } from "@/sync/sync-context"',
      'import type { State } from "@/sync/types"',
    ].join("\n")

    expect(analyzeSyncInternalImports(componentFile("chat", "Widget.tsx"), source)).toEqual([])
    expect(
      analyzeSyncInternalImports(syncFile("materialization.ts"), 'import { areMessagesEqual } from "./event-reducer"'),
    ).toEqual([])
  })

  test("honors the frozen ReconnectBanner exception only for event-pipeline", () => {
    const banner = componentFile("ui", "ReconnectBanner.tsx")

    expect(analyzeSyncInternalImports(banner, 'import { requestSyncRetryNow } from "@/sync/event-pipeline"')).toEqual(
      [],
    )
    expect(analyzeSyncInternalImports(banner, 'import { ChildStoreManager } from "@/sync/child-store"')).toHaveLength(1)
  })
})

describe("R3 transport consumer registry", () => {
  test("blocks unregistered consumers of the unified transport client", () => {
    const violations = analyzeEventTransportClientImports(
      componentFile("ui", "ReconnectBanner.tsx"),
      'import { createEventTransport } from "@/lib/event-stream/client"',
    )

    expect(violations).toHaveLength(1)
    expect(violations[0].rule).toBe("R3")
  })

  test("allows the registered consumers", () => {
    expect(EVENT_TRANSPORT_CLIENT_CONSUMERS).toEqual([
      "desktop/packages/ui/src/lib/event-stream/subscribe.ts",
      "desktop/packages/ui/src/lib/event-stream/client.test.ts",
      "desktop/packages/ui/src/sync/event-pipeline.ts",
    ])

    expect(
      analyzeEventTransportClientImports(
        syncFile("event-pipeline.ts"),
        'import { createEventTransport } from "@/lib/event-stream/client"',
      ),
    ).toEqual([])
    expect(
      analyzeEventTransportClientImports(
        path.join(uiSrc, "lib/event-stream/subscribe.ts"),
        'import { createEventTransport } from "./client"',
      ),
    ).toEqual([])
  })
})

describe("R4 duplicate exported hook names", () => {
  test("collects locally defined hook names", () => {
    const names = collectExportedHookNames(
      syncFile("notification-store.ts"),
      [
        "export const useSyncNotificationStore = create(() => ({}))",
        "export function useSessionUnseenCount(sessionId: string) { return 0 }",
        "export type Notification = { time: number }",
        "export function appendNotification() {}",
      ].join("\n"),
    )

    expect(names).toEqual(["useSyncNotificationStore", "useSessionUnseenCount"])
  })

  test("treats in-scope barrels as transparent", () => {
    expect(collectExportedHookNames(storeFile("useUIStore.ts"), 'export * from "./useUIStore-impl"')).toEqual([])
    expect(
      collectExportedHookNames(
        storeFile("useConfigStore.ts"),
        'export { useConfigStore } from "./useConfigStore-impl"',
      ),
    ).toEqual([])
    expect(
      collectExportedHookNames(storeFile("useUIStore-impl.ts"), "export const useUIStore = create(() => ({}))"),
    ).toEqual(["useUIStore"])
  })

  test("flags the same hook name defined by two modules", () => {
    const violations = findDuplicateHookNames(
      new Map([
        [
          "useNotificationStore",
          [
            "desktop/packages/ui/src/stores/useNotificationStore.ts",
            "desktop/packages/ui/src/sync/notification-store.ts",
          ],
        ],
        ["useUniqueStore", ["desktop/packages/ui/src/stores/useUniqueStore.ts"]],
      ]),
    )

    expect(violations).toHaveLength(2)
    expect(violations.every((item) => item.rule === "R4" && item.specifier === "useNotificationStore")).toBe(true)
  })
})

test("the current UI tree satisfies the store boundary policy", async () => {
  const { violations, warnings } = await collectDesktopStoreBoundaryViolations()
  expect(warnings).toEqual([])
  expect(violations).toEqual([])
})
