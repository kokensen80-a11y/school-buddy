/**
 * Password hashing for local accounts.
 *
 * Be honest about what this is: a profile lock for a shared device, not encryption.
 * The password itself is never stored, only a slow salted hash, so somebody who
 * opens the browser's storage cannot read it back. The study data of every account
 * is however stored unencrypted in that same browser storage: anyone with access to
 * the device and its developer tools can read it without knowing any password.
 */
import { BackendError } from './types';

export const DEFAULT_PBKDF2_ITERATIONS = 300_000;

const SALT_BYTES = 16;
const HASH_BITS = 256;

/** What is stored instead of the password. `salt` and `hash` are base64. */
export interface PasswordHash {
  algorithm: 'PBKDF2-SHA-256';
  iterations: number;
  salt: string;
  hash: string;
}

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

const fromBase64 = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

/** WebCrypto, which browsers only offer on secure origins (https, localhost). */
function webCrypto(): Crypto {
  const candidate: Crypto | undefined = globalThis.crypto;
  if (!candidate?.subtle) throw new BackendError('crypto-unavailable');
  return candidate;
}

async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const { subtle } = webCrypto();
  // NFKC makes the same password typed on another keyboard or system produce the same bytes.
  const material = new TextEncoder().encode(password.normalize('NFKC'));
  const key = await subtle.importKey('raw', material, 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

/** Compares without stopping at the first difference, so timing does not reveal where it is. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return difference === 0;
}

export async function hashPassword(
  password: string,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS,
): Promise<PasswordHash> {
  const salt = webCrypto().getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, iterations);
  return { algorithm: 'PBKDF2-SHA-256', iterations, salt: toBase64(salt), hash: toBase64(hash) };
}

/** Uses the iteration count stored with the hash, so old hashes keep working when the default rises. */
export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  let salt: Uint8Array<ArrayBuffer>;
  let expected: Uint8Array;
  try {
    salt = fromBase64(stored.salt);
    expected = fromBase64(stored.hash);
  } catch {
    return false;
  }
  return constantTimeEqual(await derive(password, salt, stored.iterations), expected);
}

export function isPasswordHash(value: unknown): value is PasswordHash {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PasswordHash>;
  return (
    candidate.algorithm === 'PBKDF2-SHA-256' &&
    typeof candidate.iterations === 'number' &&
    Number.isInteger(candidate.iterations) &&
    candidate.iterations > 0 &&
    typeof candidate.salt === 'string' &&
    typeof candidate.hash === 'string'
  );
}
