export const MINI_CHAT_PRESENCE_CHANNEL = 'openchamber:mini-chat-presence';

export type MiniChatPresenceMessage = {
  readonly type: 'mini-chat-session-presence';
  readonly sessionId: string;
  readonly directory: string;
  readonly viewed?: boolean;
};

export function isMiniChatPresenceMessage(value: unknown): value is MiniChatPresenceMessage {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const message = value as Record<string, unknown>;
  return (
    message.type === 'mini-chat-session-presence' &&
    typeof message.sessionId === 'string' &&
    message.sessionId.length > 0 &&
    typeof message.directory === 'string' &&
    message.directory.length > 0 &&
    (typeof message.viewed === 'boolean' || typeof message.viewed === 'undefined')
  );
}
