import z from "zod"
import { Storage } from "../../storage/storage"
import { QualityStorageKey } from "../storage-key"

/**
 * Shared storage skeleton for the scoped (global/project) promotion policy
 * stores. The three concrete stores differ only in their key prefix, record
 * kind literals, policy schema, and error-message noun; the KV layout
 * (`<prefix>/global`, `<prefix>/project/<encoded id>`), the record envelope,
 * the CRUD helpers, and the list ordering live here exactly once, while each
 * store keeps its own zod schemas, `resolve()` precedence, and renderers.
 * Persisted shapes and keys are unchanged, so existing records need no
 * migration. This module stays leaf-only (Storage + storage-key) so stores can
 * inject cross-store fallbacks (e.g. the release policy's compatibility
 * approval lookup) without an import cycle.
 */
export namespace QualityScopedPolicyStore {
  export const Scope = z.enum(["global", "project"])
  export type Scope = z.output<typeof Scope>

  export type RecordOf<P> = {
    scope: Scope
    projectID: string | null
    updatedAt: string
    policy: P
  }

  export type Store<R extends RecordOf<P>, P> = {
    requireProjectID: (projectID: string | null | undefined) => string
    writeRecord: (scope: Scope, policy: P, projectID?: string | null) => Promise<R>
    getGlobal: () => Promise<R | undefined>
    getProject: (projectID: string) => Promise<R | undefined>
    setGlobal: (policy: P) => Promise<R>
    setProject: (projectID: string, policy: P) => Promise<R>
    clearGlobal: () => Promise<void>
    clearProject: (projectID: string) => Promise<void>
    list: () => Promise<R[]>
  }

  export function create<R extends RecordOf<P>, P>(config: {
    keyPrefix: string
    scopeNoun: string
    parseRecord: (raw: unknown) => R
    buildRecord: (scope: Scope, projectID: string | null, policy: P) => R
  }): Store<R, P> {
    const encode = QualityStorageKey.encode
    const decode = QualityStorageKey.decode

    function requireProjectID(projectID: string | null | undefined) {
      const normalized = projectID?.trim()
      if (!normalized) throw new Error(`projectID is required for project-scoped ${config.scopeNoun}`)
      return normalized
    }

    function globalKey() {
      return [config.keyPrefix, "global"]
    }

    function projectKey(projectID: string) {
      return [config.keyPrefix, "project", encode(projectID)]
    }

    async function writeRecord(scope: Scope, policy: P, projectID?: string | null): Promise<R> {
      const normalizedProjectID = scope === "project" ? requireProjectID(projectID) : null
      const next = config.buildRecord(scope, normalizedProjectID, policy)
      const targetKey = scope === "project" ? projectKey(requireProjectID(normalizedProjectID)) : globalKey()
      await Storage.write(targetKey, next)
      return next
    }

    async function getGlobal(): Promise<R | undefined> {
      try {
        return config.parseRecord(await Storage.read<unknown>(globalKey()))
      } catch (err) {
        if (Storage.NotFoundError.isInstance(err)) return
        throw err
      }
    }

    async function getProject(projectID: string): Promise<R | undefined> {
      try {
        return config.parseRecord(await Storage.read<unknown>(projectKey(requireProjectID(projectID))))
      } catch (err) {
        if (Storage.NotFoundError.isInstance(err)) return
        throw err
      }
    }

    async function list(): Promise<R[]> {
      const keys = await Storage.list([config.keyPrefix])
      const records: R[] = []
      for (const parts of keys) {
        if (parts[1] === "global") {
          const record = await getGlobal()
          if (record) records.push(record)
          continue
        }
        if (parts[1] !== "project") continue
        const encodedProjectID = parts[2]
        if (!encodedProjectID) continue
        const projectID = decode(encodedProjectID)
        if (!projectID) continue
        const record = await getProject(projectID)
        if (record) records.push(record)
      }
      return records.sort((a, b) => {
        const byScope = a.scope.localeCompare(b.scope)
        if (byScope !== 0) return byScope
        const byProject = (a.projectID ?? "").localeCompare(b.projectID ?? "")
        if (byProject !== 0) return byProject
        return a.updatedAt.localeCompare(b.updatedAt)
      })
    }

    return {
      requireProjectID,
      writeRecord,
      getGlobal,
      getProject,
      setGlobal: (policy) => writeRecord("global", policy, null),
      setProject: (projectID, policy) => writeRecord("project", policy, projectID),
      clearGlobal: () => Storage.remove(globalKey()),
      clearProject: (projectID) => Storage.remove(projectKey(requireProjectID(projectID))),
      list,
    }
  }
}
