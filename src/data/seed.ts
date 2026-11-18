import type { Note, TopicMeta } from '../types';

export const seedNotes: Note[] = [
  {
    id: 1,
    time: 'Hoy, 08:30',
    topic: 'estructura',
    blockType: 'todo',
    done: false,
    text: 'Verificar **cuantía mínima** de armadura por retracción en losa nervada (`e = 25 cm`).',
    links: ['tesis-hle']
  },
  {
    id: 2,
    time: 'Hoy, 09:15',
    topic: 'rust-core',
    blockType: 'text',
    text: 'Función base para ensamblar la matriz de rigidez global sin asignaciones innecesarias:',
    code: 'fn assemble_stiffness(elements: &[BeamElement]) -> Array2<f64> {\n    Array2::<f64>::zeros((dof, dof))\n}',
    links: ['estructura']
  },
  {
    id: 3,
    time: 'Hoy, 10:05',
    topic: 'ai',
    isAI: true,
    model: 'Gemini',
    text: 'Clasificado automáticamente: Vinculé tu nota de **Tesis HLE** sobre módulo elástico con la página de **Estructura** en Notion.',
    links: ['tesis-hle', 'estructura']
  },
  {
    id: 4,
    time: 'Ayer',
    topic: 'obra',
    blockType: 'callout',
    text: 'Coordinar recepción de hormigón *H-30* en sector norte y registrar asentamiento en cono de Abrams.',
    links: ['estructura']
  }
];

export const seedTopics: Record<string, TopicMeta> = {
  'estructura': { label: 'Estructura', notionDest: 'DB / Cálculo Estructural', bg: 'var(--pastel-blue-bg)', fg: 'var(--pastel-blue-fg)', dot: '#6384e0' },
  'rust-core': { label: 'Rust Core', notionDest: 'Page / Motor Rust', bg: 'var(--pastel-purple-bg)', fg: 'var(--pastel-purple-fg)', dot: '#8b5cf6' },
  'tesis-hle': { label: 'Tesis HLE', notionDest: 'DB / Investigación HLE', bg: 'var(--pastel-mint-bg)', fg: 'var(--pastel-mint-fg)', dot: '#34d399' },
  'obra': { label: 'Obra', notionDest: 'DB / Bitácora Obra', bg: 'var(--pastel-peach-bg)', fg: 'var(--pastel-peach-fg)', dot: '#f59e0b' }
};

/** Estilo para temas creados al vuelo con @tema o /mover @tema */
export function newTopicMeta(key: string): TopicMeta {
  return { label: key, notionDest: `Page / ${key}`, bg: 'var(--pastel-rose-bg)', fg: 'var(--pastel-rose-fg)', dot: '#f43f5e' };
}
