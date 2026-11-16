import type { ID } from '../../types';

const hex = (byte: number) => byte.toString(16).padStart(2, '0');

/**
 * A random UUID (version 4). `crypto.randomUUID` only exists on secure origins
 * (https, localhost), so on plain http the id is built from random bytes instead.
 */
export function newId(): ID {
  const webCrypto: Crypto | undefined = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof webCrypto?.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const h = Array.from(bytes, hex);
  return [
    h.slice(0, 4).join(''),
    h.slice(4, 6).join(''),
    h.slice(6, 8).join(''),
    h.slice(8, 10).join(''),
    h.slice(10, 16).join(''),
  ].join('-');
}
