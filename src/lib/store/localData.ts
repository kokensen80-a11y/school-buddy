/**
 * DataBackend for data that lives on this device only.
 *
 *   localStorage  sb.data.<accountId>                 one account's UserData as JSON
 *   IndexedDB     school-buddy / attachments          one record per attachment file
 *
 * Nothing here is encrypted: see password.ts.
 */
import type { ID } from '../../types';
import {
  KEY_PREFIX,
  isQuotaError,
  onChangeElsewhere,
  readJson,
  removeKey,
  writeJson,
} from './localStorageJson';
import { BackendError, type DataBackend } from './types';

const DATA_KEY_PREFIX = `${KEY_PREFIX}data.`;
const DATABASE_NAME = 'school-buddy';
const DATABASE_VERSION = 1;
const ATTACHMENTS = 'attachments';
const BY_ACCOUNT = 'accountId';

/**
 * Files are stored as bytes plus their MIME type rather than as Blob objects:
 * that works in every browser, also in the ones that cannot keep Blobs in IndexedDB.
 */
interface AttachmentRecord {
  id: ID;
  accountId: ID;
  mime: string;
  bytes: ArrayBuffer;
}

const dataKey = (accountId: ID) => `${DATA_KEY_PREFIX}${accountId}`;

function toBackendError(error: unknown): BackendError {
  if (error instanceof BackendError) return error;
  return new BackendError(isQuotaError(error) ? 'storage-full' : 'storage-unavailable');
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      reject(toBackendError(error));
      return;
    }
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(ATTACHMENTS, { keyPath: 'id' });
      store.createIndex(BY_ACCOUNT, 'accountId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(toBackendError(request.error));
  });
}

/**
 * Runs `work` in one transaction on the attachment store and resolves, once the
 * transaction is committed, with the result of the request that `work` returned.
 */
async function transact<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(ATTACHMENTS, mode);
      const request = work(transaction.objectStore(ATTACHMENTS));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) {
    throw toBackendError(error);
  } finally {
    database.close();
  }
}

async function deleteAttachmentsOf(accountId: ID): Promise<void> {
  await transact('readwrite', (store) => {
    const keys = store.index(BY_ACCOUNT).getAllKeys(IDBKeyRange.only(accountId));
    keys.onsuccess = () => {
      for (const key of keys.result) store.delete(key);
    };
    return keys;
  });
}

export function createLocalDataBackend(): DataBackend {
  return {
    async load(accountId) {
      return readJson(dataKey(accountId));
    },

    async save(accountId, data) {
      writeJson(dataKey(accountId), data);
    },

    async remove(accountId) {
      removeKey(dataKey(accountId));
      await deleteAttachmentsOf(accountId);
    },

    async putAttachment(accountId, attachmentId, blob) {
      const record: AttachmentRecord = {
        id: attachmentId,
        accountId,
        mime: blob.type,
        bytes: await blob.arrayBuffer(),
      };
      await transact('readwrite', (store) => store.put(record));
    },

    async getAttachment(accountId, attachmentId) {
      const record = await transact<AttachmentRecord | undefined>('readonly', (store) =>
        store.get(attachmentId),
      );
      if (!record || record.accountId !== accountId) return undefined;
      return new Blob([record.bytes], { type: record.mime });
    },

    async deleteAttachment(accountId, attachmentId) {
      await transact('readwrite', (store) => {
        const lookup: IDBRequest<AttachmentRecord | undefined> = store.get(attachmentId);
        lookup.onsuccess = () => {
          if (lookup.result?.accountId === accountId) store.delete(attachmentId);
        };
        return lookup;
      });
    },

    subscribe(listener) {
      return onChangeElsewhere((key) => key.startsWith(DATA_KEY_PREFIX), listener);
    },
  };
}
