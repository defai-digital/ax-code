import z from "zod"
import { Storage } from "../../storage/storage"
import { QualityStorageKey } from "../storage-key"
import { jsonEqual } from "../json"

/**
 * Write-once KV skeleton shared by the promotion artifact namespaces:
 * get/append/list/assertPersisted over Storage, keyed by
 * [prefix, encode(source), id]. Appends are idempotent for identical
 * content and reject a conflicting write for an existing id. Each
 * namespace keeps its own record schema, sort order, parent-link hook, and
 * error noun — only the storage plumbing lives here.
 */
export function createPromotionArtifactStore<TArtifact extends { source: string }, TRecord>(config: {
  keyPrefix: string
  recordKind: string
  artifactField: string
  idField: keyof TArtifact & string
  /** Display noun used in conflict/persistence error messages, e.g. "Promotion export bundle". */
  noun: string
  recordSchema: z.ZodType<TRecord>
  sort: (items: TArtifact[]) => TArtifact[]
  /** Upstream artifact persisted first; omit for the root of the chain. */
  parent?: {
    append: (artifact: TArtifact) => Promise<unknown>
    assertPersisted: (artifact: TArtifact) => Promise<unknown>
  }
  /** Override for a namespace whose conflict message predates the shared wording. */
  conflictMessage?: (id: string, source: string) => string
}) {
  const encode = QualityStorageKey.encode
  const decode = QualityStorageKey.decode

  function key(source: string, id: string) {
    // The id is a single storage path component, never a path. A dot segment
    // or a separator would let path.join resolve the write outside the
    // namespace (or hide it from list), so reject it at the boundary.
    if (id === "" || id === "." || id === ".." || id.includes("/") || id.includes("\\")) {
      throw new Error(`Promotion artifact id must be a single path segment: ${JSON.stringify(id)}`)
    }
    return [config.keyPrefix, encode(source), id]
  }

  function artifactID(artifact: TArtifact): string {
    return String(artifact[config.idField])
  }

  function artifactOf(record: TRecord): TArtifact {
    return (record as Record<string, unknown>)[config.artifactField] as TArtifact
  }

  function conflictMessage(id: string, source: string) {
    if (config.conflictMessage) return config.conflictMessage(id, source)
    return `${config.noun} ${id} already exists for source ${source} with different content`
  }

  async function get(input: { source: string; id: string }): Promise<TRecord> {
    const record = await Storage.read<unknown>(key(input.source, input.id))
    return config.recordSchema.parse(record)
  }

  async function append(artifact: TArtifact): Promise<TRecord> {
    if (config.parent) await config.parent.append(artifact)
    const next = config.recordSchema.parse({
      schemaVersion: 1,
      kind: config.recordKind,
      [config.artifactField]: artifact,
    })
    const id = artifactID(artifact)
    try {
      const existing = await get({ source: artifact.source, id })
      if (jsonEqual(existing, next)) return existing
      throw new Error(conflictMessage(id, artifact.source))
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(key(artifact.source, id), next)
      return next
    }
  }

  async function list(source?: string): Promise<TArtifact[]> {
    const prefixes = source ? [[config.keyPrefix, encode(source)]] : [[config.keyPrefix]]
    const items: TArtifact[] = []
    for (const prefix of prefixes) {
      const keys = await Storage.list(prefix)
      for (const parts of keys) {
        const encodedSource = parts[parts.length - 2]
        const id = parts[parts.length - 1]
        if (!encodedSource || !id) continue
        const decoded = decode(encodedSource)
        if (!decoded) continue
        const record = await get({ source: decoded, id })
        items.push(artifactOf(record))
      }
    }
    return config.sort(items)
  }

  async function assertPersisted(artifact: TArtifact): Promise<TRecord> {
    if (config.parent) await config.parent.assertPersisted(artifact)
    const id = artifactID(artifact)
    const persisted = await get({ source: artifact.source, id })
    if (!jsonEqual(artifactOf(persisted), artifact)) {
      const noun = config.noun.charAt(0).toLowerCase() + config.noun.slice(1)
      throw new Error(`Persisted ${noun} ${id} does not match the provided artifact`)
    }
    return persisted
  }

  return { key, get, append, list, assertPersisted }
}
