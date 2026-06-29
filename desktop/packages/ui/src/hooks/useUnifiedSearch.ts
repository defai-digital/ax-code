import { useEffect, useMemo, useState } from "react"
import { useGlobalSessionsStore } from "@/stores/useGlobalSessionsStore"
import { useDirectoryStore } from "@/stores/useDirectoryStore"
import { useFileSearchStore } from "@/stores/useFileSearchStore"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { scoreByFuzzyQuery } from "@/lib/search/fuzzySearch"
import type { Session } from "@ax-code/sdk/v2"

export type SearchGroup = "sessions" | "files" | "commands" | "settings"

export type FileHit = { path: string; name: string; relativePath: string }

export interface UnifiedSearchState {
  query: string
  debouncedQuery: string
  trimmedQuery: string
  hasQuery: boolean
  fileResults: FileHit[]
  isSearchingFiles: boolean
  activeSessions: Session[]
  scoredSessions: { item: Session; score: number }[]
  scoredFiles: { item: FileHit; score: number }[]
}

export function useUnifiedSearch(isOpen: boolean): UnifiedSearchState {
  const [query, setQuery] = useState("")
  const debouncedQuery = useDebouncedValue(query, 200)
  const trimmedQuery = debouncedQuery.trim()
  const hasQuery = query.trim().length > 0

  const activeSessions = useGlobalSessionsStore((s) => s.activeSessions)
  const currentDirectory = useDirectoryStore((s) => s.currentDirectory)
  const searchFiles = useFileSearchStore((s) => s.searchFiles)

  const currentRoot = useMemo(() => {
    if (!currentDirectory) return null
    return currentDirectory.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/+$/, "") || "/"
  }, [currentDirectory])

  // Clear query when palette closes
  useEffect(() => {
    if (!isOpen) setQuery("")
  }, [isOpen])

  // File search
  const [fileResults, setFileResults] = useState<FileHit[]>([])
  const [isSearchingFiles, setIsSearchingFiles] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setFileResults([])
      setIsSearchingFiles(false)
      return
    }
    if (!currentRoot || trimmedQuery.length === 0) {
      setFileResults([])
      setIsSearchingFiles(false)
      return
    }
    let cancelled = false
    setIsSearchingFiles(true)
    void searchFiles(currentRoot, trimmedQuery, 10, { type: "file" })
      .then((results) => {
        if (cancelled) return
        setFileResults(
          results.map((file) => ({
            path: file.path.replace(/\\/g, "/"),
            name: file.name,
            relativePath: file.relativePath,
          })),
        )
      })
      .catch(() => {
        if (!cancelled) setFileResults([])
      })
      .finally(() => {
        if (!cancelled) setIsSearchingFiles(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, currentRoot, trimmedQuery, searchFiles])

  // Score sessions
  const sortedActiveSessions = useMemo(() => {
    const getUpdated = (s: Session) =>
      (typeof s.time?.updated === "number" ? s.time.updated : 0) ||
      (typeof s.time?.created === "number" ? s.time.created : 0)
    return [...activeSessions].sort((a, b) => getUpdated(b) - getUpdated(a))
  }, [activeSessions])

  const scoredSessions = useMemo(() => {
    if (!hasQuery) return sortedActiveSessions.slice(0, 5).map((item) => ({ item, score: 0 }))
    return scoreByFuzzyQuery(sortedActiveSessions, query.trim(), (s) => s.title || "", {
      limit: 7,
      threshold: 0.2,
    })
  }, [sortedActiveSessions, query, hasQuery])

  // Score files
  const scoredFiles = useMemo(() => {
    if (!hasQuery || fileResults.length === 0) return []
    return scoreByFuzzyQuery(fileResults, query.trim(), (f) => f.name, {
      limit: 10,
      threshold: 0.4,
    })
  }, [fileResults, query, hasQuery])

  return {
    query,
    debouncedQuery,
    trimmedQuery,
    hasQuery,
    fileResults,
    isSearchingFiles,
    activeSessions: sortedActiveSessions,
    scoredSessions,
    scoredFiles,
  }
}
