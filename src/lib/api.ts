import type { NotionSession } from '../types';
import type { NotionBlock } from './parser';
import { KEYS, getItem } from './storage';

/**
 * Cliente de los endpoints serverless.
 * La sesión OAuth viaja en una cookie httpOnly (el navegador la envía sola);
 * el token interno manual, si existe, tiene prioridad y va en `x-notion-token`.
 */
function notionHeaders(): Record<string, string> {
  return apiHeaders();
}

/** Cabeceras comunes: clave de acceso de Senda, token manual y página destino. */
export function apiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const key = getItem(KEYS.accessKey);
  if (key) headers['x-senda-key'] = key;
  const token = getItem(KEYS.notionToken);
  if (token) headers['x-notion-token'] = token;
  const page = getItem(KEYS.notionPage);
  if (page) headers['x-notion-page-id'] = page;
  return headers;
}

/** true si el último intento falló por falta de clave de acceso */
export let accessKeyRequired = false;

export async function fetchNotionSession(): Promise<NotionSession | null> {
  try {
    const res = await fetch('/api/notion-sync', { headers: notionHeaders(), credentials: 'same-origin' });
    if (res.status === 401) {
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      accessKeyRequired = body.code === 'access_key';
    }
    if (!res.ok) return null;
    accessKeyRequired = false;
    return (await res.json()) as NotionSession;
  } catch {
    return null;
  }
}

/** Añade bloques a Notion. Devuelve los IDs creados, o null si falló. */
export async function appendBlocks(blocks: NotionBlock[], targetPageId: string): Promise<string[] | null> {
  try {
    const res = await fetch('/api/notion-sync', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...notionHeaders() },
      body: JSON.stringify({ targetPageId: targetPageId || undefined, blocks })
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: { id: string }[] };
    return (data.results || []).map((r) => r.id);
  } catch {
    return null;
  }
}

/** Borra bloques en Notion (van a la papelera de Notion, se pueden restaurar allí). */
export async function deleteBlocks(ids: string[]): Promise<boolean> {
  try {
    const res = await fetch('/api/notion-sync?ids=' + encodeURIComponent(ids.join(',')), {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: notionHeaders()
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Marca o desmarca una casilla de tarea en Notion. */
export async function setTodoChecked(blockId: string, checked: boolean, property?: string): Promise<boolean> {
  try {
    const res = await fetch('/api/notion-sync', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...notionHeaders() },
      body: JSON.stringify({ blockId, checked, property })
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface AiResponse {
  model?: string;
  text?: string;
  /** Motivo del fallo devuelto por el servidor (sin llave, cuota, modelo…) */
  error?: string;
  /** missing_key: falta la llave · unavailable: proveedor saturado/caído · rejected: llave inválida o sin crédito */
  code?: 'missing_key' | 'unavailable' | 'rejected';
  parsed?: { topic?: string; blockType?: string; cleanText?: string; relatedTopics?: string[]; summary?: string };
}

export async function aiRoute(
  mode: 'gemini' | 'claude' | 'auto' | 'extract',
  prompt: string,
  availableTopics: string[],
  extra: Record<string, unknown> = {}
): Promise<AiResponse> {
  try {
    const res = await fetch('/api/ai-route', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...apiHeaders(),
        'x-gemini-key': getItem(KEYS.gemini),
        'x-claude-key': getItem(KEYS.claude)
      },
      body: JSON.stringify({ mode, prompt, availableTopics, ...extra })
    });
    const data = (await res.json().catch(() => ({}))) as AiResponse;
    if (!res.ok) return { error: data.error || `El servidor respondió ${res.status}`, code: data.code };
    return data;
  } catch {
    return { error: 'Sin conexión con el servidor', code: 'unavailable' };
  }
}

/** Crea una fila en una base de Notion. Devuelve el ID de la página creada, o null. */
export async function createRow(databaseId: string, properties: Record<string, unknown>): Promise<string[] | null> {
  try {
    const res = await fetch('/api/notion-sync', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...notionHeaders() },
      body: JSON.stringify({ databaseId, properties })
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: { id: string }[] };
    return (data.results || []).map((r) => r.id);
  } catch {
    return null;
  }
}

export const OAUTH_LOGIN_URL = '/api/oauth-login';

export async function logoutNotion(): Promise<void> {
  try {
    await fetch('/api/oauth-logout', { method: 'POST', credentials: 'same-origin' });
  } catch {
    /* sin red: la cookie expirará igual */
  }
}
