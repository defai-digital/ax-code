import React from "react"
import type { StoreApi } from "zustand"
import type { PermissionRequest } from "@/types/permission"
import type { QuestionRequest } from "@/types/question"
import { flattenBlockingRequests } from "../lib/blockingRequests"

type PermissionState = { permission: Record<string, PermissionRequest[] | undefined> }
type QuestionState = { question: Record<string, QuestionRequest[] | undefined> }

const EMPTY_PERMISSIONS: PermissionRequest[] = []
const EMPTY_QUESTIONS: QuestionRequest[] = []

/**
 * Subscribe only to permission arrays for the given session IDs.
 * Unrelated sessions' permission events do not re-render the consumer.
 */
export function useScopedPermissions(
  store: StoreApi<PermissionState>,
  sessionIds: readonly string[],
): PermissionRequest[] {
  const idsKey = sessionIds.join("\0")
  const cacheRef = React.useRef<{
    idsKey: string
    refs: Array<PermissionRequest[] | undefined>
    result: PermissionRequest[]
  }>({ idsKey: "", refs: [], result: EMPTY_PERMISSIONS })

  const getSnapshot = React.useCallback(() => {
    if (!idsKey) {
      cacheRef.current = { idsKey: "", refs: [], result: EMPTY_PERMISSIONS }
      return EMPTY_PERMISSIONS
    }
    const ids = idsKey.split("\0").filter(Boolean)
    const refs = ids.map((id) => store.getState().permission[id])
    const cache = cacheRef.current
    if (cache.idsKey === idsKey && refs.every((entry, index) => entry === cache.refs[index])) {
      return cache.result
    }
    const map = new Map<string, PermissionRequest[]>()
    for (let i = 0; i < ids.length; i++) {
      const list = refs[i]
      if (list?.length) map.set(ids[i], list)
    }
    const result = flattenBlockingRequests(map, ids)
    const nextResult = result.length === 0 ? EMPTY_PERMISSIONS : result
    cacheRef.current = { idsKey, refs, result: nextResult }
    return nextResult
  }, [store, idsKey])

  const subscribe = React.useCallback(
    (notify: () => void) => {
      if (!idsKey) return () => undefined
      const ids = idsKey.split("\0").filter(Boolean)
      let prev = ids.map((id) => store.getState().permission[id])
      return store.subscribe(() => {
        const next = ids.map((id) => store.getState().permission[id])
        if (next.every((entry, index) => entry === prev[index])) return
        prev = next
        notify()
      })
    },
    [store, idsKey],
  )

  return React.useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_PERMISSIONS)
}

/**
 * Subscribe only to question arrays for the given session IDs.
 */
export function useScopedQuestions(
  store: StoreApi<QuestionState>,
  sessionIds: readonly string[],
): QuestionRequest[] {
  const idsKey = sessionIds.join("\0")
  const cacheRef = React.useRef<{
    idsKey: string
    refs: Array<QuestionRequest[] | undefined>
    result: QuestionRequest[]
  }>({ idsKey: "", refs: [], result: EMPTY_QUESTIONS })

  const getSnapshot = React.useCallback(() => {
    if (!idsKey) {
      cacheRef.current = { idsKey: "", refs: [], result: EMPTY_QUESTIONS }
      return EMPTY_QUESTIONS
    }
    const ids = idsKey.split("\0").filter(Boolean)
    const refs = ids.map((id) => store.getState().question[id])
    const cache = cacheRef.current
    if (cache.idsKey === idsKey && refs.every((entry, index) => entry === cache.refs[index])) {
      return cache.result
    }
    const map = new Map<string, QuestionRequest[]>()
    for (let i = 0; i < ids.length; i++) {
      const list = refs[i]
      if (list?.length) map.set(ids[i], list)
    }
    const result = flattenBlockingRequests(map, ids)
    const nextResult = result.length === 0 ? EMPTY_QUESTIONS : result
    cacheRef.current = { idsKey, refs, result: nextResult }
    return nextResult
  }, [store, idsKey])

  const subscribe = React.useCallback(
    (notify: () => void) => {
      if (!idsKey) return () => undefined
      const ids = idsKey.split("\0").filter(Boolean)
      let prev = ids.map((id) => store.getState().question[id])
      return store.subscribe(() => {
        const next = ids.map((id) => store.getState().question[id])
        if (next.every((entry, index) => entry === prev[index])) return
        prev = next
        notify()
      })
    },
    [store, idsKey],
  )

  return React.useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_QUESTIONS)
}
