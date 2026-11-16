/** The limits the store enforces. The error sentences in messages.ts quote them. */

export const MIN_PASSWORD_LENGTH = 8;

export const MAX_ATTACHMENT_MB = 15;
export const MAX_ATTACHMENT_BYTES = MAX_ATTACHMENT_MB * 1024 * 1024;

/** The notification centre keeps only the newest items. */
export const MAX_INBOX_ITEMS = 100;

/** Upper bound for the estimated minutes of one topic (100 hours). */
export const MAX_TOPIC_MINUTES = 6000;

export const MAX_EXAM_WEIGHT = 100;
