import type { NotionSession } from '../types';
import type { NotionBlock } from './parser';
import { KEYS, getItem } from './storage';

/**
 * Cliente de los endpoints serverless.
 * La sesión OAuth viaja en una cookie httpOnly (el navegador la envía sola);
 * el token interno manual, si existe, tiene prioridad y va en `x-notion-token`.
 */
function notionHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = getItem(KEYS.notionToken);
  if (token) headers['x-notion-token'] = token;
  return headers;
}

export async function fetchNotionSession(): Promise<NotionSession | null> {
  try {
    const res = await fetch('/api/notion-sync', { headers: notionHeaders(), credentials: 'same-origin' });
    if (!res.ok) return null;
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
export async function setTodoChecked(blockId: string, checked: boolean): Promise<boolean> {
  try {
    const res = await fetch('/api/notion-sync', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...notionHeaders() },
      body: JSON.stringify({ blockId, checked })
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface AiResponse {
  model?: string;
  text?: string;
  parsed?: { topic?: string; blockType?: string; cleanText?: string; relatedTopics?: string[]; summary?: string };
}

export async function aiRoute(mode: 'gemini' | 'claude' | 'auto', prompt: string, availableTopics: string[]): Promise<AiResponse | null> {
  try {
    const res = await fetch('/api/ai-route', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-gemini-key': getItem(KEYS.gemini),
        'x-claude-key': getItem(KEYS.claude)
      },
      body: JSON.stringify({ mode, prompt, availableTopics })
    });
    if (!res.ok) return null;
    return (await res.json()) as AiResponse;
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
