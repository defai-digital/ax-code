/**
 * Intelligence-in-loop nudge (ADR-048 Phase 3).
 *
 * When a session has multi-file mutations, surface guidance to run
 * impact_analyze / semantic-diff before claiming done.
 */

import { asRecordOrUndefined } from "../util/record"
import { MUTATION_TOOLS } from "../tool/mutation-tools"

export namespace IntelligenceNudge {
  export type Message = {
    info?: { role?: string }
    parts?: readonly unknown[]
  }

  export type Decision =
    | { active: false }
    | {
        active: true
        mutatedFiles: number
        text: string
      }

  export function evaluate(messages: readonly Message[]): Decision {
    const files = new Set<string>()
    for (const message of messages) {
      if (message.info?.role !== "assistant") continue
      for (const part of message.parts ?? []) {
        const record = asRecordOrUndefined(part)
        if (!record || record["type"] !== "tool") continue
        const tool = record["tool"]
        if (typeof tool !== "string" || !MUTATION_TOOLS.has(tool)) continue
        const state = asRecordOrUndefined(record["state"])
        if (state?.["status"] !== "completed") continue
        const input = asRecordOrUndefined(state["input"])
        const path =
          (typeof input?.["filePath"] === "string" && input["filePath"]) ||
          (typeof input?.["path"] === "string" && input["path"]) ||
          (typeof input?.["file"] === "string" && input["file"]) ||
          undefined
        if (path) {
          files.add(path)
          continue
        }
        // Patch-style tools (apply_patch, refactor_apply) name their files in
        // the result metadata. A mutation with no known path is not counted:
        // giving each call its own key made two patches to one file look like
        // a multi-file session.
        const changed = asRecordOrUndefined(state["metadata"])?.["files"]
        if (!Array.isArray(changed)) continue
        for (const entry of changed) {
          const filePath = asRecordOrUndefined(entry)?.["filePath"]
          if (typeof filePath === "string" && filePath) files.add(filePath)
        }
      }
    }

    if (files.size < 2) return { active: false }

    return {
      active: true,
      mutatedFiles: files.size,
      text: [
        `<intelligence_nudge>`,
        `  This session has multi-file mutations (${files.size} paths).`,
        `  Before claiming done, prefer impact_analyze on changed symbols/files and review a semantic-diff of the session changes.`,
        `  Use code_intelligence or lsp for callers/callees when available.`,
        `</intelligence_nudge>`,
      ].join("\n"),
    }
  }
}
