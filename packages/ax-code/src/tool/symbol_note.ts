import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./symbol_note.txt"
import { Instance } from "../project/instance"
import { CodeIntelligence } from "../code-intelligence"
import { CodeNodeID } from "../code-intelligence/id"

// Explicit agent tool for symbol-anchored cross-session notes (ADR-056).
// Resolves a canonical Symbol from a CodeNodeID and records a note keyed by
// qualified name, deriving file/signature/identity from the resolved symbol.
// Emits an "note" relevance signal. A failed record surfaces to the caller.

const MAX_BODY_LENGTH = 2000

export const SymbolNoteTool = Tool.define("symbol_note", {
  description: DESCRIPTION,
  parameters: z.object({
    symbolId: z.string().min(1).describe("CodeNodeID of the symbol (from findSymbol)"),
    kind: z.enum(["hypothesis", "fact", "caveat"]).describe("Note kind"),
    body: z.string().min(1).max(MAX_BODY_LENGTH).describe(`Bounded note body (max ${MAX_BODY_LENGTH} chars)`),
  }),
  execute: async (args, ctx) => {
    const projectID = Instance.project.id
    const symbol = CodeIntelligence.getSymbol(projectID, CodeNodeID.make(args.symbolId), { scope: "worktree" })

    let output: string
    let metadata: { noteId: string | null; freshness: string | null; qualifiedName: string }

    if (!symbol) {
      output = `No indexed symbol found for id ${args.symbolId}. Resolve one via findSymbol first.`
      metadata = { noteId: null, freshness: null, qualifiedName: args.symbolId }
    } else {
      const note = CodeIntelligence.recordNote(projectID, {
        qualifiedName: symbol.qualifiedName,
        file: symbol.file,
        kind: args.kind,
        body: args.body,
        sessionId: ctx.sessionID,
        origin: "explicit",
        symbolNameAtWrite: symbol.name,
        symbolKindAtWrite: symbol.kind,
        signatureAtWrite: symbol.signature ?? undefined,
      })
      CodeIntelligence.recordSignal(projectID, {
        qualifiedName: symbol.qualifiedName,
        file: symbol.file,
        signalType: "note",
      })
      output = `Recorded ${args.kind} note on ${symbol.qualifiedName} (${note.freshness}).`
      metadata = { noteId: note.id, freshness: note.freshness, qualifiedName: symbol.qualifiedName }
    }

    return { title: "symbol_note", output, metadata }
  },
})
