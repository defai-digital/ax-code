import {
  DocumentSymbol as DocumentSymbolValue,
  Hover as HoverValue,
  Location as LocationValue,
  LocationLink as LocationLinkValue,
  Range as RangeValue,
} from "vscode-languageserver-types"
import type {
  CallHierarchyIncomingCall,
  CallHierarchyItem,
  CallHierarchyOutgoingCall,
  DocumentSymbol,
  Hover,
  Location,
  LocationLink,
  SymbolInformation,
  WorkspaceSymbol,
} from "vscode-languageserver-types"

export type {
  CallHierarchyIncomingCall,
  CallHierarchyItem,
  CallHierarchyOutgoingCall,
  DocumentSymbol,
  Hover,
  Location,
  LocationLink,
  SymbolInformation,
  WorkspaceSymbol,
}

export type NavigationLocation = Location | LocationLink
export type CallHierarchyCall = CallHierarchyIncomingCall | CallHierarchyOutgoingCall
export type ResolvedWorkspaceSymbol = WorkspaceSymbol & { location: Location }
export type DocumentSymbolResult = DocumentSymbol | SymbolInformation

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function resultItems(value: unknown): unknown[] {
  if (value === null || value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function isSymbolKind(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 26
}

function hasValidOptionalTags(value: Record<string, unknown>): boolean {
  return (
    value.tags === undefined ||
    (Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === "number" && Number.isInteger(tag)))
  )
}

export function isCallHierarchyItem(value: unknown): value is CallHierarchyItem {
  if (!isRecord(value)) return false
  return (
    typeof value.name === "string" &&
    isSymbolKind(value.kind) &&
    typeof value.uri === "string" &&
    RangeValue.is(value.range) &&
    RangeValue.is(value.selectionRange) &&
    (value.detail === undefined || typeof value.detail === "string") &&
    hasValidOptionalTags(value)
  )
}

export function isIncomingCall(value: unknown): value is CallHierarchyIncomingCall {
  if (!isRecord(value) || !isCallHierarchyItem(value.from) || !Array.isArray(value.fromRanges)) return false
  return value.fromRanges.every(RangeValue.is)
}

export function isOutgoingCall(value: unknown): value is CallHierarchyOutgoingCall {
  if (!isRecord(value) || !isCallHierarchyItem(value.to) || !Array.isArray(value.fromRanges)) return false
  return value.fromRanges.every(RangeValue.is)
}

export function isWorkspaceSymbol(value: unknown): value is WorkspaceSymbol {
  if (!isRecord(value) || typeof value.name !== "string" || !isSymbolKind(value.kind)) return false
  if (!isRecord(value.location) || typeof value.location.uri !== "string") return false
  return hasValidOptionalTags(value)
}

export function isResolvedWorkspaceSymbol(value: unknown): value is ResolvedWorkspaceSymbol {
  return isWorkspaceSymbol(value) && LocationValue.is(value.location)
}

function isSymbolInformation(value: unknown): value is SymbolInformation {
  if (!isRecord(value)) return false
  return (
    typeof value.name === "string" &&
    isSymbolKind(value.kind) &&
    LocationValue.is(value.location) &&
    (value.containerName === undefined || typeof value.containerName === "string") &&
    hasValidOptionalTags(value)
  )
}

export function normalizeHoverResults(value: unknown): Hover[] {
  return resultItems(value).filter(HoverValue.is)
}

export function normalizeNavigationLocations(value: unknown): NavigationLocation[] {
  return resultItems(value).filter(
    (item): item is NavigationLocation => LocationValue.is(item) || LocationLinkValue.is(item),
  )
}

export function normalizeLocations(value: unknown): Location[] {
  return resultItems(value).filter(LocationValue.is)
}

export function normalizeCallHierarchyItems(value: unknown): CallHierarchyItem[] {
  return resultItems(value).filter(isCallHierarchyItem)
}

export function normalizeIncomingCalls(value: unknown): CallHierarchyIncomingCall[] {
  return resultItems(value).filter(isIncomingCall)
}

export function normalizeOutgoingCalls(value: unknown): CallHierarchyOutgoingCall[] {
  return resultItems(value).filter(isOutgoingCall)
}

export function normalizeWorkspaceSymbols(value: unknown): WorkspaceSymbol[] {
  return resultItems(value).filter(isWorkspaceSymbol)
}

export function normalizeDocumentSymbols(value: unknown): DocumentSymbolResult[] {
  return resultItems(value).filter(
    (item): item is DocumentSymbolResult => DocumentSymbolValue.is(item) || isSymbolInformation(item),
  )
}
