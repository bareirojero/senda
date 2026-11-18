import type { Note, TopicMeta, View } from './types';
import { DEFAULT_TOPIC, LEGACY_SAMPLE_IDS, defaultTopics, newTopicMeta, paletteFor, slugify } from './data/seed';
import { KEYS, getJSON, setJSON } from './lib/storage';
import { norm } from './lib/extract';

// Arranca vacío. Si quedaron guardadas las notas de muestra de v5.1, se eliminan.
const stored = getJSON<Note[] | null>(KEYS.notes, null) || [];
const cleaned = stored.filter((n) => !LEGACY_SAMPLE_IDS.has(n.id));

export const state = {
  notes: cleaned,
  topics: structuredClone(defaultTopics) as Record<string, TopicMeta>,
  activeView: 'stream' as View,
  activeTopic: null as string | null,
  searchText: ''
};

// Respuestas que quedaron a medias si se cerró la app mientras la IA contestaba
for (const n of cleaned) {
  if (n.pending) Object.assign(n, { pending: false, text: n.text || '*Sin respuesta: la app se cerró antes de recibirla.*' });
  if (n.status === 'sending') n.status = 'error';
}

if (cleaned.length !== stored.length) setJSON(KEYS.notes, cleaned);

// Temas creados en sesiones anteriores (@tema) siguen apareciendo en la barra lateral.
for (const n of state.notes) {
  if (n.topic && n.topic !== 'ai' && !state.topics[n.topic]) state.topics[n.topic] = newTopicMeta(n.topic);
}

export function persistNotes(): void {
  setJSON(KEYS.notes, state.notes);
}

export function ensureTopic(key: string, meta?: TopicMeta): TopicMeta {
  if (!state.topics[key]) state.topics[key] = meta || newTopicMeta(key);
  return state.topics[key];
}

/**
 * Páginas y bases compartidas con Senda pasan a ser temas:
 * @slug envía a esa página, o crea una fila si es una base.
 */
export function syncTopicsFromNotion(pages: { id: string; title: string }[], databases: { id: string; title: string }[] = []): void {
  for (const [key, meta] of Object.entries(state.topics)) {
    if (meta.pageId || meta.databaseId) delete state.topics[key];
  }
  for (const d of databases) {
    const key = slugify(d.title) || d.id.replace(/-/g, '').slice(0, 8);
    if (key === DEFAULT_TOPIC) continue;
    state.topics[key] = { label: d.title, notionDest: `DB / ${d.title}`, databaseId: d.id, ...paletteFor(key) };
  }
  for (const p of pages) {
    const key = slugify(p.title) || p.id.replace(/-/g, '').slice(0, 8);
    if (key === DEFAULT_TOPIC || state.topics[key]) continue;
    state.topics[key] = { label: p.title, notionDest: `Page / ${p.title}`, pageId: p.id, ...paletteFor(key) };
  }
  // Temas de notas guardadas cuya página ya no existe vuelven a ser temas locales.
  for (const n of state.notes) {
    if (n.topic && n.topic !== 'ai' && !state.topics[n.topic]) state.topics[n.topic] = newTopicMeta(n.topic);
  }
}

/**
 * "@tareas", "@mis", "@obras", "@mi-dia" → clave del tema (base o página) que mejor coincide.
 * Exacto > empieza igual > alguna palabra empieza igual; a igualdad, gana una base.
 */
export function findTopic(token: string): string | undefined {
  const t = norm(token);
  if (!t) return undefined;
  let best: { key: string; score: number } | undefined;
  for (const [key, meta] of Object.entries(state.topics)) {
    if (key === 'ai') continue;
    const k = norm(key);
    const l = norm(meta.label);
    let score = 0;
    if (k === t || l === t) score = 30;
    else if (k.startsWith(t) || l.startsWith(t)) score = 20;
    else if (l.split(' ').some((w) => w.startsWith(t))) score = 10;
    if (!score) continue;
    if (meta.databaseId) score += 2;
    else if (meta.pageId) score += 1;
    if (!best || score > best.score) best = { key, score };
  }
  return best?.key;
}
