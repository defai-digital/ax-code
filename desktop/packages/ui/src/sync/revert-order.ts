type OrderedMessage = {
  id: string
  role?: string | null
}

const findMessageIndex = <T extends OrderedMessage>(messages: readonly T[], messageId?: string): number => {
  if (!messageId) return -1
  return messages.findIndex((message) => message.id === messageId)
}

export const getVisibleMessagesBeforeRevert = <T extends OrderedMessage>(
  messages: readonly T[],
  revertMessageId?: string,
): T[] => {
  const revertIndex = findMessageIndex(messages, revertMessageId)
  if (revertIndex < 0) return [...messages]
  return messages.slice(0, revertIndex)
}

export const getRevertedUserMessages = <T extends OrderedMessage>(
  messages: readonly T[],
  revertMessageId?: string,
): T[] => {
  const revertIndex = findMessageIndex(messages, revertMessageId)
  if (revertIndex < 0) return []
  return messages.slice(revertIndex).filter((message) => message.role === "user")
}

export const getPreviousUserMessageBefore = <T extends OrderedMessage>(
  userMessages: readonly T[],
  messageId?: string,
): T | undefined => {
  if (!messageId) return userMessages[userMessages.length - 1]
  const index = findMessageIndex(userMessages, messageId)
  if (index <= 0) return undefined
  return userMessages[index - 1]
}

export const getNextUserMessageAfter = <T extends OrderedMessage>(
  userMessages: readonly T[],
  messageId?: string,
): T | undefined => {
  const index = findMessageIndex(userMessages, messageId)
  if (index < 0) return undefined
  return userMessages[index + 1]
}
