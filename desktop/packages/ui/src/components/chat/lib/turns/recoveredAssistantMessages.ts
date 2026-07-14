type AssistantMessageLike = {
  info: {
    id: string
    error?: unknown
  }
}

export const recoveredAssistantMessageIds = <T extends AssistantMessageLike>(messages: T[]) => {
  const recovered = new Set<string>()
  let hasLaterSuccessfulAttempt = false

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.info.error) {
      if (hasLaterSuccessfulAttempt) {
        recovered.add(message.info.id)
      }
      continue
    }
    hasLaterSuccessfulAttempt = true
  }

  return recovered
}

export const omitRecoveredAssistantMessages = <T extends AssistantMessageLike>(messages: T[]) => {
  const recovered = recoveredAssistantMessageIds(messages)
  if (recovered.size === 0) return messages
  return messages.filter((message) => !recovered.has(message.info.id))
}
