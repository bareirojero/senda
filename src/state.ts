import type { Note, TopicMeta, View } from './types';
import { seedNotes, seedTopics, newTopicMeta } from './data/seed';
import { KEYS, getJSON, setJSON } from './lib/storage';

export const state = {
  notes: getJSON<Note[] | null>(KEYS.notes, null) || structuredClone(seedNotes),
  topics: structuredClone(seedTopics) as Record<string, TopicMeta>,
  activeView: 'stream' as View,
  activeTopic: null as string | null,
  searchText: ''
};

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
