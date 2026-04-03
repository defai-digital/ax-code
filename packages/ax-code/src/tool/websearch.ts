import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./websearch.txt"
import { EXA_DEFAULT_NUM_RESULTS } from "@/constants/network"
import { fetchExaTool } from "./exa-fetch"
import { Isolation } from "@/isolation"

export const WebSearchTool = Tool.define("websearch", async () => {
  return {
    get description() {
      return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
    },
    parameters: z.object({
      query: z.string().describe("Websearch query"),
      numResults: z.number().optional().describe("Number of search results to return (default: 8)"),
      livecrawl: z
        .enum(["fallback", "preferred"])
        .optional()
        .describe(
          "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
        ),
      type: z
        .enum(["auto", "fast", "deep"])
        .optional()
        .describe(
          "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
        ),
      contextMaxCharacters: z
        .number()
        .optional()
        .describe("Maximum characters for context string optimized for LLMs (default: 10000)"),
    }),
    async execute(params, ctx) {
      Isolation.assertNetwork(ctx.extra?.isolation)

      await ctx.ask({
        permission: "websearch",
        patterns: [params.query],
        always: ["*"],
        metadata: {
          query: params.query,
          numResults: params.numResults,
          livecrawl: params.livecrawl,
          type: params.type,
          contextMaxCharacters: params.contextMaxCharacters,
        },
      })

      return fetchExaTool({
        request: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "web_search_exa",
            arguments: {
              query: params.query,
              type: params.type || "auto",
              numResults: params.numResults || EXA_DEFAULT_NUM_RESULTS,
              livecrawl: params.livecrawl || "fallback",
              contextMaxCharacters: params.contextMaxCharacters,
            },
          },
        },
        timeout: 25000,
        errorPrefix: "Search error",
        noResultsMessage: "No search results found. Please try a different query.",
        title: `Web search: ${params.query}`,
        abort: ctx.abort,
      })
    },
  }
})
