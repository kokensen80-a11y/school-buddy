/**
 * AuthBackend for accounts that live on this device only.
 *
 *   sb.accounts   every account with its password hash
 *   sb.session    which account is signed in ({ accountId })
 *
 * A local account is a profile lock for a shared device, nothing more: see password.ts.
 */
import type { Account, ID } from '../../types';
import { newId } from './ids';
import { KEY_PREFIX, onChangeElsewhere, readJson, removeKey, writeJson } from './localStorageJson';
import {
  DEFAULT_PBKDF2_ITERATIONS,
  hashPassword,
  isPasswordHash,
  verifyPassword,
  type PasswordHash,
} from './password';
import { BackendError, type AuthBackend } from './types';

const ACCOUNTS_KEY = `${KEY_PREFIX}accounts`;
const SESSION_KEY = `${KEY_PREFIX}session`;

interface StoredAccount extends Account {
  password: PasswordHash;
}

export interface LocalAuthOptions {
  /** PBKDF2 iterations for new password hashes. Tests pass a small number. */
  iterations?: number;
  clock?: () => Date;
}

function isStoredAccount(value: unknown): value is StoredAccount {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StoredAccount>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id !== '' &&
    typeof candidate.name === 'string' &&
    typeof candidate.email === 'string' &&
    typeof candidate.createdAt === 'string' &&
    isPasswordHash(candidate.password)
  );
}

function readAccounts(): StoredAccount[] {
  const stored = readJson(ACCOUNTS_KEY);
  return Array.isArray(stored) ? stored.filter(isStoredAccount) : [];
}

function readSessionAccountId(): ID | null {
  const session = readJson(SESSION_KEY);
  if (typeof session !== 'object' || session === null) return null;
  const { accountId } = session as { accountId?: unknown };
  return typeof accountId === 'string' ? accountId : null;
}

/** E-mail addresses are compared trimmed and without regard to case. */
const emailKey = (email: string) => email.trim().toLowerCase();

const toAccount = ({ id, name, email, createdAt }: StoredAccount): Account => ({
  id,
  name,
  email,
  createdAt,
});

function requireAccount(accounts: StoredAccount[], accountId: ID): StoredAccount {
  const account = accounts.find((candidate) => candidate.id === accountId);
  if (!account) throw new BackendError('account-not-found');
  return account;
}

function isEmailTaken(accounts: StoredAccount[], email: string, exceptId?: ID): boolean {
  return accounts.some(
    (account) => account.id !== exceptId && emailKey(account.email) === emailKey(email),
  );
}

/**
 * Hashing is slow on purpose and always happens before the account list is read
 * for writing: reading and writing are then one synchronous step, so two tabs
 * cannot overwrite each other's changes.
 */
export function createLocalAuthBackend({
  iterations = DEFAULT_PBKDF2_ITERATIONS,
  clock = () => new Date(),
}: LocalAuthOptions = {}): AuthBackend {
  return {
    async register({ name, email, password }) {
      if (isEmailTaken(readAccounts(), email)) throw new BackendError('email-taken');
      const hash = await hashPassword(password, iterations);
      const accounts = readAccounts();
      if (isEmailTaken(accounts, email)) throw new BackendError('email-taken');
      const account: StoredAccount = {
        id: newId(),
        name: name.trim(),
        email: email.trim(),
        createdAt: clock().toISOString(),
        password: hash,
      };
      writeJson(ACCOUNTS_KEY, [...accounts, account]);
      try {
        writeJson(SESSION_KEY, { accountId: account.id });
      } catch (error) {
        // Do not leave behind an account that the user was told could not be created.
        writeJson(ACCOUNTS_KEY, accounts);
        throw error;
      }
      return toAccount(account);
    },

    async login({ email, password }) {
      const account = readAccounts().find(
        (candidate) => emailKey(candidate.email) === emailKey(email),
      );
      if (!account || !(await verifyPassword(password, account.password))) {
        throw new BackendError('invalid-credentials');
      }
      writeJson(SESSION_KEY, { accountId: account.id });
      return toAccount(account);
    },

    async logout() {
      removeKey(SESSION_KEY);
    },

    async restore() {
      const accountId = readSessionAccountId();
      if (accountId === null) return null;
      const account = readAccounts().find((candidate) => candidate.id === accountId);
      if (!account) {
        // The account was deleted (in another tab, or by clearing site data).
        removeKey(SESSION_KEY);
        return null;
      }
      return toAccount(account);
    },

    async updateAccount(accountId, patch) {
      const accounts = readAccounts();
      const current = requireAccount(accounts, accountId);
      const email = patch.email === undefined ? current.email : patch.email.trim();
      if (isEmailTaken(accounts, email, accountId)) throw new BackendError('email-taken');
      const updated: StoredAccount = {
        ...current,
        name: patch.name === undefined ? current.name : patch.name.trim(),
        email,
      };
      writeJson(
        ACCOUNTS_KEY,
        accounts.map((account) => (account.id === accountId ? updated : account)),
      );
      return toAccount(updated);
    },

    async changePassword(accountId, current, next) {
      const account = requireAccount(readAccounts(), accountId);
      if (!(await verifyPassword(current, account.password))) {
        throw new BackendError('wrong-password');
      }
      const password = await hashPassword(next, iterations);
      const accounts = readAccounts();
      requireAccount(accounts, accountId);
      writeJson(
        ACCOUNTS_KEY,
        accounts.map((stored) => (stored.id === accountId ? { ...stored, password } : stored)),
      );
    },

    async deleteAccount(accountId, password) {
      const account = requireAccount(readAccounts(), accountId);
      if (!(await verifyPassword(password, account.password))) {
        throw new BackendError('wrong-password');
      }
      writeJson(
        ACCOUNTS_KEY,
        readAccounts().filter((stored) => stored.id !== accountId),
      );
      if (readSessionAccountId() === accountId) removeKey(SESSION_KEY);
    },

    subscribe(listener) {
      return onChangeElsewhere((key) => key === ACCOUNTS_KEY || key === SESSION_KEY, listener);
    },
  };
}
