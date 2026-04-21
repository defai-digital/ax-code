export type MessageSyncEvent<
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
> =
  | { type: "message.updated"; properties: { info: TMessage } }
  | { type: "message.removed"; properties: { sessionID: string; messageID: string } }
  | { type: "message.part.updated"; properties: { part: TPart } }
  | { type: "message.part.delta"; properties: { messageID: string; partID: string; field: string; delta: string } }
  | { type: "message.part.removed"; properties: { messageID: string; partID: string } }

export interface MessageSyncEventHandlers<
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
> {
  updateMessage: (sessionID: string, message: TMessage) => void
  deleteMessage: (sessionID: string, messageID: string) => void
  updatePart: (messageID: string, part: TPart) => void
  appendPartDelta: (messageID: string, partID: string, delta: string) => void
  deletePart: (messageID: string, partID: string) => void
}

export function handleMessageSyncEvent<
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
>(
  event: MessageSyncEvent<TMessage, TPart>,
  handlers: MessageSyncEventHandlers<TMessage, TPart>,
) {
  switch (event.type) {
    case "message.updated":
      handlers.updateMessage(event.properties.info.sessionID, event.properties.info)
      return true

    case "message.removed":
      handlers.deleteMessage(event.properties.sessionID, event.properties.messageID)
      return true

    case "message.part.updated":
      handlers.updatePart(event.properties.part.messageID, event.properties.part)
      return true

    case "message.part.delta":
      if (event.properties.field !== "text") return true
      handlers.appendPartDelta(event.properties.messageID, event.properties.partID, event.properties.delta)
      return true

    case "message.part.removed":
      handlers.deletePart(event.properties.messageID, event.properties.partID)
      return true
  }
}
