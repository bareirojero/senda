// Tipos mínimos de las funciones Node de Vercel (evita depender de @vercel/node).
// Los archivos bajo api/_lib/ no se publican como endpoints (prefijo "_").
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface ApiRequest extends IncomingMessage {
  query: Record<string, string | string[] | undefined>;
  cookies: Record<string, string | undefined>;
  body: any;
}

export interface ApiResponse extends ServerResponse {
  status(code: number): ApiResponse;
  json(body: unknown): ApiResponse;
  send(body: unknown): ApiResponse;
  redirect(statusOrUrl: number | string, url?: string): ApiResponse;
}

export function header(req: ApiRequest, name: string): string {
  const v = req.headers[name.toLowerCase()];
  return (Array.isArray(v) ? v[0] : v) || '';
}

export function queryParam(req: ApiRequest, name: string): string {
  const v = req.query?.[name];
  return (Array.isArray(v) ? v[0] : v) || '';
}

/** Origen público de la app (https://senda.vercel.app). APP_URL tiene prioridad. */
export function appOrigin(req: ApiRequest): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const proto = header(req, 'x-forwarded-proto') || 'https';
  const host = header(req, 'x-forwarded-host') || header(req, 'host');
  return `${proto}://${host}`;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
