import type { Part } from "@ax-code/sdk/v2";
import { isFullySyntheticMessage } from "@/lib/messages/synthetic";

export interface MessageInfo {
    id: string;
    role: string;
    time?: {
        created?: number;
        completed?: number;
    };
    status?: string;
    streaming?: boolean;
    finish?: string;
}

export interface MessageRecord {
    info: MessageInfo & Record<string, unknown>;
    parts: Part[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

const getRecordField = (value: unknown, key: string): unknown =>
    isRecord(value) ? value[key] : undefined;

export function isMessageComplete(messageInfo: MessageInfo, parts: Part[] = []): boolean {
    if (isFullySyntheticMessage(parts)) {
        return true;
    }

    const timeInfo = messageInfo?.time ?? {};
    const completedAt = typeof timeInfo?.completed === 'number' ? timeInfo.completed : undefined;
    const messageStatus = messageInfo?.status;

    const hasStopFinish = messageInfo.finish === 'stop';

    const hasCompletedFlag = (typeof completedAt === 'number' && completedAt > 0) || messageStatus === 'completed';
    if (!hasCompletedFlag || !hasStopFinish) {
        return false;
    }

    const hasActiveTools = parts.some((part) => {
        switch (part.type) {
            case 'reasoning': {
                const time = getRecordField(part, 'time');
                return !isRecord(time) || typeof time.end === 'undefined';
            }
            case 'tool': {
                const state = getRecordField(part, 'state');
                const status = getRecordField(state, 'status');
                return status === 'running' || status === 'pending';
            }
            default:
                return false;
        }
    });

    return !hasActiveTools;
}

export function getLatestAssistantMessageId(messages: MessageRecord[]): string | null {
    const assistantMessages = messages
        .filter(msg => msg.info.role === 'assistant' && !isFullySyntheticMessage(msg.parts))
        .sort((a, b) => (a.info.id || "").localeCompare(b.info.id || ""));

    return assistantMessages.length > 0
        ? assistantMessages[assistantMessages.length - 1].info.id
        : null;
}

export function hasAnimatingWork(messages: MessageRecord[]): boolean {
    if (messages.length === 0) {
        return false;
    }

    for (const message of messages) {
        if (message.info.role !== 'assistant') {
            continue;
        }

        if (isFullySyntheticMessage(message.parts)) {
            continue;
        }

        if (!isMessageComplete(message.info, message.parts)) {
            return true;
        }
    }

    return false;
}

export function shouldContinueStreaming(
    messages: MessageRecord[],
    currentStreamingId: string | null
): boolean {
    const latestId = getLatestAssistantMessageId(messages);
    if (!latestId) {
        return false;
    }

    if (currentStreamingId && currentStreamingId !== latestId) {
        return true;
    }

    const latestMessage = messages.find(
        (msg) => msg.info.id === latestId && !isFullySyntheticMessage(msg.parts)
    );
    if (!latestMessage) {
        return false;
    }

    return !isMessageComplete(latestMessage.info, latestMessage.parts);
}
