import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"

// Observe metadata only: hashing large executables on each model request
// would defeat resident reuse. Include the resolved launcher and its native
// sibling, since package upgrades can replace either independently.
export async function axEngineBinaryIdentity(options: { binaryPath: string; binaryVersion?: string }): Promise<string> {
  const launcher = await fs.realpath(options.binaryPath)
  const files = [launcher, path.join(path.dirname(launcher), "ax-engine-server")]
  const identities = await Promise.all(
    files.map(async (file, index) => {
      try {
        const resolved = await fs.realpath(file)
        const stat = await fs.stat(resolved, { bigint: true })
        return [resolved, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String)
      } catch (error) {
        if (index === 1 && (error as NodeJS.ErrnoException).code === "ENOENT") return [file, "absent"]
        throw error
      }
    }),
  )
  return createHash("sha256")
    .update(JSON.stringify([options.binaryVersion ?? null, identities]))
    .digest("hex")
}
