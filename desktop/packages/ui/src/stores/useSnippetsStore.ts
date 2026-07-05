import { create } from "zustand"
import { devtools } from "zustand/middleware"
import type { Snippet } from "@/types/snippet"
import { API_ENDPOINTS } from "@/lib/http"
import { getActiveConfigDirectory } from "@/stores/utils/configDirectory"
import { getDirectoryCacheKey } from "@/stores/utils/cacheKey"

export type SnippetScope = "global" | "project"

export interface SnippetDraft {
  name: string
  scope: SnippetScope
  content?: string
  aliases?: string[]
  description?: string
}

interface SnippetsStore {
  snippets: Snippet[]
  isLoading: boolean
  selectedSnippetName: string | null
  snippetDraft: SnippetDraft | null

  setSelectedSnippet: (name: string | null) => void
  setSnippetDraft: (draft: SnippetDraft | null) => void
  loadSnippets: () => Promise<boolean>
  createSnippet: (
    name: string,
    content: string,
    options?: { aliases?: string[]; description?: string; scope?: SnippetScope },
  ) => Promise<boolean>
  updateSnippet: (
    name: string,
    updates: { content?: string; aliases?: string[]; description?: string },
  ) => Promise<boolean>
  deleteSnippet: (name: string) => Promise<boolean>
  expandText: (text: string) => Promise<string>
  getSnippetByName: (name: string) => Snippet | undefined
}

const SNIPPETS_LOAD_CACHE_TTL_MS = 5000
const snippetsByCacheKey = new Map<string, Snippet[]>()
const snippetsLastLoadedAt = new Map<string, number>()
const snippetsLoadInFlight = new Map<string, Promise<boolean>>()
const snippetsCacheVersions = new Map<string, number>()
let activeSnippetsCacheKey = getDirectoryCacheKey(null)

const getSnippetsCacheVersion = (cacheKey: string): number => snippetsCacheVersions.get(cacheKey) ?? 0

const invalidateSnippetsCache = (directory: string | null): void => {
  const cacheKey = getDirectoryCacheKey(directory)
  snippetsByCacheKey.delete(cacheKey)
  snippetsLastLoadedAt.delete(cacheKey)
  snippetsLoadInFlight.delete(cacheKey)
  snippetsCacheVersions.set(cacheKey, getSnippetsCacheVersion(cacheKey) + 1)
}

const getRequestDirectory = (): string | null => getActiveConfigDirectory("SnippetsStore")

export const useSnippetsStore = create<SnippetsStore>()(
  devtools(
    (set, get) => ({
      snippets: [],
      isLoading: false,
      selectedSnippetName: null,
      snippetDraft: null,

      setSelectedSnippet: (name) => set({ selectedSnippetName: name }),
      setSnippetDraft: (draft) => set({ snippetDraft: draft }),

      loadSnippets: async () => {
        const directory = getRequestDirectory()
        const cacheKey = getDirectoryCacheKey(directory)
        const cachedSnippets = snippetsByCacheKey.get(cacheKey)
        activeSnippetsCacheKey = cacheKey

        const now = Date.now()
        const loadedAt = snippetsLastLoadedAt.get(cacheKey) ?? 0
        if (cachedSnippets && now - loadedAt < SNIPPETS_LOAD_CACHE_TTL_MS) {
          set({ snippets: cachedSnippets, isLoading: false })
          return true
        }

        const inFlight = snippetsLoadInFlight.get(cacheKey)
        if (inFlight) {
          set({ isLoading: true, snippets: cachedSnippets ?? [] })
          return inFlight
        }

        const requestVersion = getSnippetsCacheVersion(cacheKey)

        const request = (async () => {
          set({ isLoading: true, snippets: cachedSnippets ?? [] })
          try {
            const queryParams = directory ? `?directory=${encodeURIComponent(directory)}` : ""
            const response = await fetch(`${API_ENDPOINTS.config.snippets}${queryParams}`, {
              headers: { "Cache-Control": "no-cache", ...(directory ? { "x-ax-code-directory": directory } : {}) },
            })
            if (!response.ok) throw new Error("Failed to load snippets")
            const snippets: Snippet[] = await response.json()
            if (getSnippetsCacheVersion(cacheKey) !== requestVersion) {
              return false
            }
            snippetsByCacheKey.set(cacheKey, snippets)
            snippetsLastLoadedAt.set(cacheKey, Date.now())
            if (activeSnippetsCacheKey === cacheKey) {
              set({ snippets, isLoading: false })
            }
            return true
          } catch (error) {
            console.error("[SnippetsStore] Failed to load:", error)
            if (activeSnippetsCacheKey === cacheKey) {
              set({ isLoading: false })
            }
            return false
          }
        })()

        snippetsLoadInFlight.set(cacheKey, request)
        try {
          return await request
        } finally {
          if (snippetsLoadInFlight.get(cacheKey) === request) {
            snippetsLoadInFlight.delete(cacheKey)
          }
        }
      },

      createSnippet: async (name, content, options = {}) => {
        try {
          const directory = getRequestDirectory()
          const queryParams = directory ? `?directory=${encodeURIComponent(directory)}` : ""
          const response = await fetch(
            `${API_ENDPOINTS.config.snippet.replace(":name", encodeURIComponent(name))}${queryParams}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(directory ? { "x-ax-code-directory": directory } : {}),
              },
              body: JSON.stringify({
                content,
                aliases: options.aliases,
                description: options.description,
                scope: options.scope,
              }),
            },
          )
          if (!response.ok) {
            const payload = await response.json().catch(() => null)
            if (response.status === 409) {
              return await get().updateSnippet(name, {
                content,
                aliases: options.aliases,
                description: options.description,
              })
            }
            throw new Error(payload?.error || "Failed to create snippet")
          }
          invalidateSnippetsCache(directory)
          await get().loadSnippets()
          return true
        } catch (error) {
          console.error("[SnippetsStore] Failed to create:", error)
          return false
        }
      },

      updateSnippet: async (name, updates) => {
        try {
          const directory = getRequestDirectory()
          const queryParams = directory ? `?directory=${encodeURIComponent(directory)}` : ""
          const response = await fetch(
            `${API_ENDPOINTS.config.snippet.replace(":name", encodeURIComponent(name))}${queryParams}`,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                ...(directory ? { "x-ax-code-directory": directory } : {}),
              },
              body: JSON.stringify(updates),
            },
          )
          if (!response.ok)
            throw new Error((await response.json().catch(() => null))?.error || "Failed to update snippet")
          invalidateSnippetsCache(directory)
          await get().loadSnippets()
          return true
        } catch (error) {
          console.error("[SnippetsStore] Failed to update:", error)
          return false
        }
      },

      deleteSnippet: async (name) => {
        try {
          const directory = getRequestDirectory()
          const queryParams = directory ? `?directory=${encodeURIComponent(directory)}` : ""
          const response = await fetch(
            `${API_ENDPOINTS.config.snippet.replace(":name", encodeURIComponent(name))}${queryParams}`,
            {
              method: "DELETE",
              headers: directory ? { "x-ax-code-directory": directory } : undefined,
            },
          )
          if (!response.ok)
            throw new Error((await response.json().catch(() => null))?.error || "Failed to delete snippet")
          if (get().selectedSnippetName === name) set({ selectedSnippetName: null })
          invalidateSnippetsCache(directory)
          await get().loadSnippets()
          return true
        } catch (error) {
          console.error("[SnippetsStore] Failed to delete:", error)
          return false
        }
      },

      expandText: async (text) => {
        if (!/#[a-z0-9_-]+/i.test(text)) return text
        const directory = getRequestDirectory()
        const queryParams = directory ? `?directory=${encodeURIComponent(directory)}` : ""
        const response = await fetch(`${API_ENDPOINTS.config.snippetExpand}${queryParams}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(directory ? { "x-ax-code-directory": directory } : {}) },
          body: JSON.stringify({ text }),
        })
        if (!response.ok)
          throw new Error((await response.json().catch(() => null))?.error || "Failed to expand snippets")
        return (await response.json()).text ?? text
      },

      getSnippetByName: (name) =>
        get().snippets.find((snippet) => snippet.name === name || snippet.aliases.includes(name)),
    }),
    { name: "snippets-store" },
  ),
)
