/**
 * i18n Type Definitions
 */

export type SupportedLanguage = "en"

export interface Translations {
  session: {
    welcome: string
    thinking: string
    generating: string
    goodbye: string
    sessionEnded: string
  }
  tools: {
    executing: string
    completed: string
    failed: string
    readingFile: string
    writingFile: string
    searchingFiles: string
    commandRunning: string
    commandCompleted: string
  }
  errors: {
    connectionFailed: string
    apiError: string
    rateLimited: string
    timeout: string
    permissionDenied: string
    fileNotFound: string
    invalidInput: string
    unknown: string
  }
  toast: {
    copiedToClipboard: string
    changesSaved: string
    operationCancelled: string
    agentSwitched: string
  }
  usage: {
    tokens: string
    tokensIn: string
    tokensOut: string
    estimatedCost: string
  }
  status: {
    thinking: string
    context: string
    contextWarning: string
  }
}

export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: "English",
}
