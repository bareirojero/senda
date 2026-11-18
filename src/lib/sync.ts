import type { Note } from '../types';
import { KEYS, getItem, getJSON, setItem, setJSON } from './storage';
import { apiHeaders } from './api';

/**
 * Sincroniza el historial con la base "Senda · Bandeja" de Notion.
 *
 * Se guarda, por nota, la última versión que se subió (`synced[id]`). Con eso:
 *  - subir = enviar solo las notas que cambiaron desde entonces,
 *  - borrar = las que se subieron alguna vez y ya no están,
 *  - fusionar = lo nuevo del servidor entra; lo que cambiaste aquí y aún no se subió, gana.
 */

interface SyncedEntry {
  /** JSON de la nota tal como se subió */
  v: string;
  /** ID de la fila en Notion */
  inboxId?: string;
}

export type SyncState = 'off' | 'syncing' | 'ok' | 'error' | 'access_key';

const SYNCED_KEY = KEYS.synced;
let synced: Record<string, SyncedEntry> = getJSON(SYNCED_KEY, {});
let timer: ReturnType<typeof setTimeout> | undefined;
let pushing = false;
let enabled = false;

let listener: (s: SyncState, detail?: string) => void = () => {};
export function onSyncState(fn: (s: SyncState, detail?: string) => void): void {
  listener = fn;
}

/** Forma canónica para comparar (sin campos locales ni efímeros). */
export function serialize(n: Note): string {
  const { inboxId: _a, pending: _b, ...rest } = n as Note & { inboxId?: string };
  return JSON.stringify(rest, Object.keys(rest).sort());
}

function saveSynced(): void {
  setJSON(SYNCED_KEY, synced);
}

async function request(method: string, body?: unknown, query = ''): Promise<Response> {
  return fetch(`/api/inbox${query}`, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...apiHeaders() },
    body: body ? JSON.stringify(body) : undefined
  });
}

/**
 * Trae el historial y los ajustes de Notion y los fusiona con lo local.
 * Devuelve las notas resultantes, o null si no se pudo.
 */
export async function pull(local: Note[]): Promise<{ notes: Note[]; settings: Record<string, string> } | null> {
  let data: { notes: (Note & { inboxId?: string })[]; settings: Record<string, string> };
  try {
    listener('syncing');
    const res = await request('GET');
    if (res.status === 401) {
      const body = await res.json().catch(() => ({}));
      listener(body.code === 'access_key' ? 'access_key' : 'error', body.error);
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    listener('error', String(err));
    return null;
  }
  enabled = true;

  const remote = new Map(data.notes.map((n) => [String(n.id), n]));
  const merged: Note[] = [];

  for (const n of local) {
    const key = String(n.id);
    const entry = synced[key];
    const r = remote.get(key);
    if (r) {
      const changedHere = entry && serialize(n) !== entry.v;
      merged.push(changedHere ? n : r);
      if (!changedHere) synced[key] = { v: serialize(r), inboxId: r.inboxId };
      remote.delete(key);
    } else if (entry) {
      // Se subió alguna vez y ya no está en Notion → se borró en otro dispositivo
      delete synced[key];
    } else {
      merged.push(n); // nueva aquí: se subirá
    }
  }
  for (const [key, r] of remote) {
    // Si la borraste aquí y aún no se propagó, no la resucitamos
    if (synced[key] && !local.some((n) => String(n.id) === key)) continue;
    merged.push(r);
    synced[key] = { v: serialize(r), inboxId: r.inboxId };
  }

  merged.sort((a, b) => b.id - a.id);
  saveSynced();
  listener('ok');
  return { notes: merged, settings: data.settings || {} };
}

/** Programa la subida de cambios (agrupa varias ediciones seguidas). */
export function schedulePush(getNotes: () => Note[]): void {
  if (!enabled) return;
  clearTimeout(timer);
  timer = setTimeout(() => void push(getNotes), 900);
}

async function push(getNotes: () => Note[]): Promise<void> {
  if (pushing) return schedulePush(getNotes);
  pushing = true;
  let failed = false;
  try {
    const notes = getNotes().filter((n) => !n.pending && n.status !== 'sending');
    const present = new Set(notes.map((n) => String(n.id)));

    // Uno por uno: Notion admite ~3 solicitudes por segundo
    for (const n of notes) {
      const key = String(n.id);
      const v = serialize(n);
      if (synced[key]?.v === v) continue;
      const res = await request('POST', { note: { ...n, inboxId: synced[key]?.inboxId } });
      if (!res.ok) { failed = true; continue; }
      const { inboxId } = await res.json();
      synced[key] = { v, inboxId };
      saveSynced();
    }
    for (const key of Object.keys(synced)) {
      if (present.has(key)) continue;
      const res = await request('DELETE', undefined, `?id=${encodeURIComponent(key)}&inboxId=${encodeURIComponent(synced[key]!.inboxId || '')}`);
      if (res.ok) {
        delete synced[key];
        saveSynced();
      } else failed = true;
    }
    listener(failed ? 'error' : 'ok');
  } catch (err) {
    listener('error', String(err));
  } finally {
    pushing = false;
  }
}

/** Ajustes compartidos entre dispositivos */
const SHARED_SETTINGS = [KEYS.tasksDb, KEYS.aiFill, KEYS.notionPage] as const;

export function applySettings(settings: Record<string, string>): void {
  for (const k of SHARED_SETTINGS) {
    if (k in settings) setItem(k, settings[k] || '');
  }
}

export async function pushSettings(): Promise<void> {
  if (!enabled) return;
  const settings: Record<string, string> = {};
  for (const k of SHARED_SETTINGS) settings[k] = getItem(k);
  await request('PUT', { settings }).catch(() => undefined);
}
