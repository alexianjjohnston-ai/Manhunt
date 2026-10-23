/**
 * DEMO BUILD ONLY: browser replacement for server/security.ts so the real game engine
 * can run inside the page. Tokens never leave the tab, so they are compared directly.
 */
import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from '@shared/constants';

function randomBytes(n: number) {
  return crypto.getRandomValues(new Uint8Array(n));
}

function base64url(bytes: Uint8Array) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomInt(max: number) {
  return Math.floor(secureRandom() * max);
}

export function newId(bytes = 12) {
  return base64url(randomBytes(bytes));
}

export function newToken() {
  return base64url(randomBytes(32));
}

export function hashToken(token: string) {
  return `demo:${token}`;
}

export function tokenMatches(token: string, hash: string) {
  return hashToken(token) === hash;
}

export function newJoinCode() {
  let code = '';
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) code += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
  return code;
}

export function newTagCode(taken: Set<string>) {
  for (;;) {
    const c = randomInt(10_000).toString().padStart(4, '0');
    if (!taken.has(c)) return c;
  }
}

export function hashPassword(password: string) {
  return `demo:${password.normalize('NFKC')}`;
}

export function verifyPassword(password: string, stored: string) {
  return hashPassword(password) === stored;
}

export function secureRandom() {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
}
