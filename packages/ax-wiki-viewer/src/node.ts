import { createHash } from "node:crypto"
import { parseWikiGraph } from "@ax-code/ax-wiki/graph"
import { browserBundle } from "./browser-bundle.js"

/** The allowlisted snapshot is the only project data embedded in the document. */
export function renderWikiGraphHtml(input: unknown): { html: string; csp: string } {
  const data = JSON.stringify(parseWikiGraph(input)).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  )
  const script = `const AX_WIKI_GRAPH=${data};\n${browserBundle}`
  if (/<!--|<script|<\/script/i.test(script)) throw new Error("Unsafe browser bundle")
  const digest = createHash("sha256").update(script).digest("base64")
  const csp = `default-src 'none'; script-src 'sha256-${digest}'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'`
  return {
    csp,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><title>AX Wiki evidence map</title><style>html,body{margin:0;height:100%;background:#101923}main{height:100%}</style></head><body><main id="wiki-viewer"></main><script>${script}</script></body></html>`,
  }
}
