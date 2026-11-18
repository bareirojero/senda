import type { TopicMeta } from '../types';

/** Tema por defecto cuando la nota no lleva @tema: va a la página destino configurada. */
export const DEFAULT_TOPIC = 'general';

export const defaultTopics: Record<string, TopicMeta> = {
  [DEFAULT_TOPIC]: {
    label: 'General',
    notionDest: 'Página destino',
    bg: 'var(--bg-subtle)',
    fg: 'var(--text-muted)',
    dot: '#94a3b8'
  }
};

/** IDs de las notas de muestra de la maqueta v5.1; se limpian de localStorage al arrancar. */
export const LEGACY_SAMPLE_IDS = new Set([1, 2, 3, 4]);

const PALETTE: Pick<TopicMeta, 'bg' | 'fg' | 'dot'>[] = [
  { bg: 'var(--pastel-blue-bg)', fg: 'var(--pastel-blue-fg)', dot: '#6384e0' },
  { bg: 'var(--pastel-purple-bg)', fg: 'var(--pastel-purple-fg)', dot: '#8b5cf6' },
  { bg: 'var(--pastel-mint-bg)', fg: 'var(--pastel-mint-fg)', dot: '#34d399' },
  { bg: 'var(--pastel-peach-bg)', fg: 'var(--pastel-peach-fg)', dot: '#f59e0b' },
  { bg: 'var(--pastel-rose-bg)', fg: 'var(--pastel-rose-fg)', dot: '#f43f5e' }
];

/** Color estable por nombre, para que un tema conserve su color entre sesiones. */
export function paletteFor(key: string): Pick<TopicMeta, 'bg' | 'fg' | 'dot'> {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

/** Estilo para temas creados al vuelo con @tema o /mover @tema */
export function newTopicMeta(key: string): TopicMeta {
  return { label: key, notionDest: `Page / ${key}`, ...paletteFor(key) };
}

/** "Bitácora de Obra" → "bitacora-de-obra" (compatible con @tema). */
export function slugify(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
