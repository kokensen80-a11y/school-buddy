/** The backup file that "export" produces and "import" reads back. */
import type { ISODateTime, UserData } from '../../types';
import { MESSAGES, fail } from './messages';
import { isRecord, sanitizeUserData } from './sanitize';
import type { Failure } from './types';

export const BACKUP_FORMAT = 'school-buddy-backup';
const BACKUP_VERSION = 1;

/** Deliberately without e-mail address or password hash: a backup is not an account. */
export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: ISODateTime;
  accountName: string;
  data: UserData;
}

export function serializeBackup(
  accountName: string,
  data: UserData,
  exportedAt: ISODateTime,
): string {
  const backup: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    accountName,
    data,
  };
  return JSON.stringify(backup, null, 2);
}

const isNewerThan = (version: unknown, supported: number) =>
  typeof version === 'number' && version > supported;

/** The sanitised data of a backup file, or a friendly failure when the text is not one. */
export function parseBackup(
  json: string,
  fallbackNow: ISODateTime,
): Failure | { ok: true; data: UserData } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return fail(MESSAGES.importInvalid);
  }
  if (!isRecord(parsed) || parsed.format !== BACKUP_FORMAT || !isRecord(parsed.data)) {
    return fail(MESSAGES.importInvalid);
  }
  if (isNewerThan(parsed.version, BACKUP_VERSION) || isNewerThan(parsed.data.version, 1)) {
    return fail(MESSAGES.importTooNew);
  }
  return { ok: true, data: sanitizeUserData(parsed.data, fallbackNow) };
}
