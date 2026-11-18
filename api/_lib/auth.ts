import { timingSafeEqual } from 'node:crypto';
import { header, type ApiRequest, type ApiResponse } from './http.js';
import { readSession } from './session.js';

export type Source = 'token' | 'oauth' | 'env';

/**
 * Clave de acceso de Senda (opcional). Si SENDA_ACCESS_KEY está definida en Vercel,
 * toda llamada a la API debe traer la misma clave en "x-senda-key"; si no, la API
 * queda abierta como antes. Protege tu Notion, tu historial y tus llaves de IA.
 * Devuelve true si la petición puede seguir; si no, ya respondió 401.
 */
export function requireAccess(req: ApiRequest, res: ApiResponse): boolean {
  const expected = process.env.SENDA_ACCESS_KEY || '';
  if (!expected) return true;
  const given = header(req, 'x-senda-key');
  const ok = given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) res.status(401).json({ error: 'Falta la clave de acceso de Senda', code: 'access_key' });
  return ok;
}

/**
 * Prioridad de credenciales de Notion:
 *   1. x-notion-token  (token interno pegado en Personalizar)
 *   2. cookie OAuth    (Conectar con Notion)
 *   3. NOTION_TOKEN    (variable de entorno del despliegue)
 */
export function resolveAuth(req: ApiRequest) {
  const manual = header(req, 'x-notion-token');
  if (manual) return { token: manual, source: 'token' as Source, session: null };
  const session = readSession(req);
  if (session) return { token: session.accessToken, source: 'oauth' as Source, session };
  if (process.env.NOTION_TOKEN) return { token: process.env.NOTION_TOKEN, source: 'env' as Source, session: null };
  return null;
}
