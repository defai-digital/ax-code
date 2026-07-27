// File-tree helpers for the files view: node sorting, absolute-path detection,
// default ignore rules, error classifiers, and parent-directory resolution.
// Extracted from FilesView-impl.tsx — behavior must stay byte-identical.

import type { FileNode } from "@/components/files/types"

import { normalizeFilesViewPath } from "./filesViewPathUtils"

export const sortFilesViewNodes = (items: FileNode[]) =>
  items.slice().sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "directory" ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })

export const isFilesViewAbsolutePath = (value: string): boolean => {
  return value.startsWith("/") || value.startsWith("//") || /^[A-Za-z]:\//.test(value)
}

const DEFAULT_IGNORED_DIR_NAMES = new Set(["node_modules"])

export const shouldIgnoreFilesViewEntryName = (name: string): boolean => DEFAULT_IGNORED_DIR_NAMES.has(name)

export const shouldIgnoreFilesViewPath = (path: string): boolean => {
  const normalized = normalizeFilesViewPath(path)
  return normalized === "node_modules" || normalized.endsWith("/node_modules") || normalized.includes("/node_modules/")
}

export const isDirectoryReadError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? "")
  const normalized = message.toLowerCase()
  return normalized.includes("is a directory") || normalized.includes("eisdir")
}

export const isFileMissingError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? "")
  const normalized = message.toLowerCase()
  return (
    normalized.includes("file not found") ||
    normalized.includes("enoent") ||
    normalized.includes("no such file") ||
    normalized.includes("does not exist")
  )
}

export const getFilesViewParentDirectoryPath = (path: string): string => {
  const normalized = normalizeFilesViewPath(path)
  if (!normalized) return ""
  if (normalized === "/" || /^[A-Za-z]:\/$/.test(normalized)) {
    return normalized
  }

  const lastSlash = normalized.lastIndexOf("/")
  if (lastSlash < 0) {
    return normalized
  }
  if (lastSlash === 0) {
    return "/"
  }

  const parent = normalized.slice(0, lastSlash)
  if (/^[A-Za-z]:$/.test(parent)) {
    return `${parent}/`
  }
  return parent
}
