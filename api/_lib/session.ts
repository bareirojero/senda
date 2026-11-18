import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ApiRequest, ApiResponse } from './http.js';

/**
 * Sesión OAuth de Notion guardada en una cookie httpOnly cifrada (AES-256-GCM).
 * El access_token nunca toca localStorage ni JavaScript del navegador.
 */

export interface NotionOAuthSession {
  accessToken: string;
  refreshToken?: string;
  botId: string;
  workspaceId: string;
  workspaceName: string | null;
  userName: string | null;
  userAvatar: string | null;
}

export const SESSION_COOKIE = 'senda_notion';
export const STATE_COOKIE = 'senda_oauth_state';
const SESSION_MAX_AGE = 60 * 60 * 24 * 180; // 180 días
const STATE_MAX_AGE = 60 * 10; // 10 minutos

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('Falta SESSION_SECRET (mínimo 32 caracteres) para cifrar la sesión de Notion.');
  }
  return createHash('sha256').update(secret).digest();
}

export function seal(data: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url');
}

export function unseal<T>(token: string): T | null {
  try {
    const raw = Buffer.from(token, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const dec = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    return JSON.parse(dec.toString('utf8')) as T;
  } catch {
    return null;
  }
}

function serializeCookie(name: string, value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === 'development' ? '' : '; Secure';
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function appendCookie(res: ApiResponse, cookie: string): void {
  const prev = res.getHeader('Set-Cookie');
  const list = Array.isArray(prev) ? prev : prev ? [String(prev)] : [];
  res.setHeader('Set-Cookie', [...list, cookie]);
}

export function readSession(req: ApiRequest): NotionOAuthSession | null {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (!raw || !process.env.SESSION_SECRET) return null;
  return unseal<NotionOAuthSession>(raw);
}

export function writeSession(res: ApiResponse, session: NotionOAuthSession): void {
  appendCookie(res, serializeCookie(SESSION_COOKIE, seal(session), SESSION_MAX_AGE));
}

export function clearSession(res: ApiResponse): void {
  appendCookie(res, serializeCookie(SESSION_COOKIE, '', 0));
}

/** Estado anti-CSRF del flujo OAuth. */
export function issueState(res: ApiResponse): string {
  const state = randomBytes(24).toString('base64url');
  appendCookie(res, serializeCookie(STATE_COOKIE, state, STATE_MAX_AGE));
  return state;
}

export function consumeState(req: ApiRequest, res: ApiResponse, received: string): boolean {
  const expected = req.cookies?.[STATE_COOKIE] || '';
  appendCookie(res, serializeCookie(STATE_COOKIE, '', 0));
  if (!expected || !received || expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}
