import { formatClockTime, type TimeFormatPreference } from '@/lib/timeFormat';

const isSameDay = (left: Date, right: Date): boolean => {
    return (
        left.getFullYear() === right.getFullYear() &&
        left.getMonth() === right.getMonth() &&
        left.getDate() === right.getDate()
    );
};

const isYesterday = (date: Date, now: Date): boolean => {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    return isSameDay(date, yesterday);
};

const isValidTimestamp = (timestamp: number): boolean => {
    return Number.isFinite(timestamp) && !Number.isNaN(new Date(timestamp).getTime());
};

export const formatTimestampForDisplay = (
    timestamp: number,
    preference: TimeFormatPreference = 'auto',
): string => {
    if (!isValidTimestamp(timestamp)) {
        return '';
    }

    const date = new Date(timestamp);
    const now = new Date();

    const timePart = formatClockTime(timestamp, preference, { fallback: '' });
    if (!timePart) {
        return '';
    }

    if (isSameDay(date, now)) {
        return timePart;
    }

    if (isYesterday(date, now)) {
        return `Yesterday ${timePart}`;
    }

    const monthPart = date.toLocaleString(undefined, { month: 'short' });
    const dayPart = date.getDate();
    const datePart = `${monthPart} ${dayPart}`;

    if (date.getFullYear() === now.getFullYear()) {
        return `${datePart}, ${timePart}`;
    }

    return `${datePart}, ${date.getFullYear()}, ${timePart}`;
};
