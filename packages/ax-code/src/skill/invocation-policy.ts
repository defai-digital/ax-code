import fs from "fs/promises"
import { constants } from "fs"
import { NamedError } from "@ax-code/util/error"
import type { FileHandle } from "fs/promises"
import path from "path"
import { ConfigMarkdown } from "../config/markdown"

export namespace SkillInvocationPolicy {
  export interface Result {
    modelInvocable: boolean
    userInvocable: boolean
    issues: string[]
  }

  // Sidecar reading is bounded before allocation: one fixed 64KiB buffer is
  // allocated up front and the file is read into it through an fs handle that
  // is always closed. A read that fills the buffer entirely is treated as
  // oversized so no truncated YAML document is ever accepted.
  const SIDECAR_MAX_BYTES = 64 * 1024
  const SIDECAR_RELATIVE = path.join("agents", "openai.yaml")
  // A line starting with `---` inside sidecar content would terminate the
  // synthetic frontmatter block early (delimiter injection), causing a
  // truncated YAML document to parse as if it were complete.
  const SIDECAR_DELIMITER_PATTERN = /^---/m

  function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  }

  function failClosed(issues: string[]): Result {
    return { modelInvocable: false, userInvocable: false, issues }
  }

  // Reads a strictly-boolean flag. Missing (undefined) returns undefined so
  // callers can apply the default; any non-boolean value records an issue.
  function booleanFlag(
    container: Record<string, unknown>,
    key: string,
    label: string,
    issues: string[],
  ): boolean | undefined {
    const value = container[key]
    if (value === undefined) return undefined
    if (typeof value !== "boolean") {
      issues.push(`${label} must be a boolean`)
      return undefined
    }
    return value
  }

  export function normalize(data: Record<string, unknown>, sidecar?: unknown): Result {
    const issues: string[] = []
    const disableModel = booleanFlag(data, "disable-model-invocation", "disable-model-invocation", issues)
    const userInvocableFlag = booleanFlag(data, "user-invocable", "user-invocable", issues)

    let allowImplicit: boolean | undefined
    if (sidecar !== undefined) {
      if (!isPlainObject(sidecar)) {
        issues.push("agents/openai.yaml: root must be a mapping")
      } else {
        const policy = sidecar.policy
        if (policy !== undefined) {
          if (!isPlainObject(policy)) {
            issues.push("agents/openai.yaml: policy must be a mapping")
          } else {
            allowImplicit = booleanFlag(policy, "allow_implicit_invocation", "policy.allow_implicit_invocation", issues)
          }
        }
      }
    }

    // Fail closed on any invalid metadata: unknown author intent must never
    // resolve to the more permissive outcome.
    if (issues.length > 0) return failClosed(issues)

    return {
      modelInvocable: disableModel !== true && allowImplicit !== false,
      userInvocable: userInvocableFlag !== false,
      issues,
    }
  }

  export async function read(location: string, data: Record<string, unknown>): Promise<Result> {
    // @scan-suppress security_scan - location is an already-discovered SKILL.md; the sibling path is the fixed agents/openai.yaml constant.
    const sidecarPath = path.join(path.dirname(location), SIDECAR_RELATIVE)

    let handle: FileHandle
    try {
      handle = await fs.open(sidecarPath, constants.O_RDONLY | constants.O_NONBLOCK)
    } catch (err) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
        return normalize(data)
      }
      return failClosed([`agents/openai.yaml: failed to read ${sidecarPath}: ${NamedError.message(err)}`])
    }

    let content: string
    try {
      try {
        if (!(await handle.stat()).isFile()) throw new Error("Sidecar must be a regular file")
        const buffer = Buffer.alloc(SIDECAR_MAX_BYTES)
        let total = 0
        while (total < buffer.length) {
          const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total)
          if (bytesRead === 0) break
          total += bytesRead
        }
        if (total === buffer.length) throw new Error(`Sidecar exceeds the ${SIDECAR_MAX_BYTES} byte limit`)
        content = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, total))
      } finally {
        await handle.close()
      }
    } catch (err) {
      return failClosed([`agents/openai.yaml: failed to read ${sidecarPath}: ${NamedError.message(err)}`])
    }

    // An empty sidecar declares nothing; defaults apply.
    if (content.trim() === "") return normalize(data)

    // Reject delimiter injection before wrapping so no truncated YAML
    // document can be accepted as complete.
    if (SIDECAR_DELIMITER_PATTERN.test(content)) {
      return failClosed([`agents/openai.yaml: ${sidecarPath} contains a standalone '---' delimiter line`])
    }

    let root: unknown
    try {
      const parsed = await ConfigMarkdown.parseText(sidecarPath, `---\n${content}\n---`, { strict: true })
      root = parsed.data
    } catch (err) {
      const message = ConfigMarkdown.FrontmatterError.isInstance(err) ? err.data.message : NamedError.message(err)
      return failClosed([`agents/openai.yaml: ${message}`])
    }

    return normalize(data, root)
  }
}
