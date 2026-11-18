import { state } from '../state';
import { escapeHtml, parseBlockMarkdown, parseInlineMarkdown } from '../lib/markdown';
import type { Note, TopicMeta } from '../types';

function topicMeta(key: string): TopicMeta {
  return (
    state.topics[key] || { label: key, notionDest: `Page / ${key}`, bg: 'var(--bg-subtle)', fg: 'var(--text-muted)', dot: '#94a3b8' }
  );
}

function visibleNotes(): Note[] {
  const q = state.searchText.toLowerCase();
  return state.notes.filter((n) => {
    if (state.activeView === 'topic' && state.activeTopic && n.topic !== state.activeTopic) return false;
    if (q) return n.text.toLowerCase().includes(q) || n.topic.toLowerCase().includes(q);
    return true;
  });
}

function contentHtml(note: Note): string {
  // Las respuestas de IA traen párrafos y listas
  if (note.isAI) return `<div class="note-content md">${parseBlockMarkdown(note.text)}</div>`;
  const t = parseInlineMarkdown(note.text);
  switch (note.blockType) {
    case 'todo':
      return `<div class="task-row ${note.done ? 'done' : ''}" data-task-id="${note.id}">
          <div class="checkbox-ui">${note.done ? '✓' : ''}</div>
          <div class="task-label">${t}</div>
        </div>`;
    case 'h1': return `<div class="note-h1">${t}</div>`;
    case 'h2': return `<div class="note-h2">${t}</div>`;
    case 'h3': return `<div class="note-h3">${t}</div>`;
    case 'quote': return `<div class="note-quote">${t}</div>`;
    case 'divider': return '<hr class="note-divider" />';
    case 'latex': return `<div class="note-latex">∑ &nbsp; ${t}</div>`;
    case 'bullet': return `<div class="note-content">• &nbsp;${t}</div>`;
    case 'num': return `<div class="note-content">1. &nbsp;${t}</div>`;
    case 'toggle':
      return `<details class="note-toggle">
          <summary class="note-toggle-header">${t}</summary>
          <div class="note-toggle-body">Contenido desplegable sincronizado con Notion.</div>
        </details>`;
    case 'media': return `<div class="note-media-pill">${t}</div>`;
    default: return `<div class="note-content">${t}</div>`;
  }
}

function cardHtml(note: Note): string {
  const meta = topicMeta(note.topic);
  const badge = note.isAI
    ? `<span class="badge-topic" style="background:rgba(107,70,193,0.12); color:var(--pastel-purple-fg);">✦ ${escapeHtml(note.model || 'IA')}</span>`
    : `<span class="badge-topic" style="background:${meta.bg}; color:${meta.fg};" data-topic="${escapeHtml(note.topic)}">${escapeHtml(meta.label)}</span>
       <span class="badge-notion-dest">→ ${escapeHtml(meta.notionDest)}</span>`;

  const code = note.code ? `<pre class="note-code"><code>${escapeHtml(note.code)}</code></pre>` : '';

  const known = (note.links || []).filter((l) => state.topics[l]);
  const links = known.length
    ? `<div class="note-connections">
         <span>Enlazado con:</span>
         ${known.map((l) => `<span class="conn-chip" data-topic="${escapeHtml(l)}">${escapeHtml(topicMeta(l).label)}</span>`).join('')}
       </div>`
    : '';

  const chips = note.chips?.length
    ? `<div class="note-chips">${note.chips.map((c) => `<span class="note-chip">${escapeHtml(c)}</span>`).join('')}</div>`
    : '';

  return `
    <div class="note-top">
      <div class="note-badges">${badge}</div>
      <div class="note-meta">
        <span class="badge-time">${escapeHtml(note.time)}</span>
        <button class="note-delete" data-delete-id="${note.id}" title="Borrar" aria-label="Borrar">
          <svg class="nav-svg" viewBox="0 0 24 24"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path></svg>
        </button>
      </div>
    </div>
    ${contentHtml(note)}
    ${chips}
    ${code}
    ${links}`;
}

export function renderNotes(feed: HTMLElement): void {
  const notes = visibleNotes();
  if (notes.length === 0) {
    // Feed vacío = nada en pantalla; el aviso solo aparece al filtrar o buscar
    if (state.notes.length === 0) {
      feed.replaceChildren();
      return;
    }
    feed.innerHTML = '<div style="text-align:center; color:var(--text-light); padding: 40px 0;">Sin notas en esta vista.</div>';
    return;
  }
  const frag = document.createDocumentFragment();
  for (const note of notes) {
    const card = document.createElement('div');
    const extra = note.isAI ? 'ai-card' : note.blockType === 'callout' ? 'callout-card' : '';
    card.className = `note-card ${extra}`;
    card.innerHTML = cardHtml(note);
    frag.appendChild(card);
  }
  feed.replaceChildren(frag);
}

export function renderSidebarTopics(container: HTMLElement, totalCount: HTMLElement): number {
  totalCount.textContent = String(state.notes.length);
  const frag = document.createDocumentFragment();
  // Bases primero (son los destinos más útiles), luego páginas y temas locales
  const entries = Object.entries(state.topics).sort(([, a], [, b]) => Number(!!b.databaseId) - Number(!!a.databaseId));
  let shown = 0;
  for (const [key, meta] of entries) {
    const count = state.notes.filter((n) => n.topic === key).length;
    // Solo páginas/bases reales de Notion o temas que ya tienen notas
    if (!meta.pageId && !meta.databaseId && count === 0) continue;
    shown++;
    const selected = state.activeView === 'topic' && state.activeTopic === key;
    const el = document.createElement('div');
    el.className = `side-link ${selected ? 'active' : ''}`;
    el.title = meta.label;
    el.dataset.topic = key;
    el.innerHTML = `
      <span class="side-link-left">
        <span class="topic-dot" style="background:${meta.dot}"></span>
        <span class="side-text">${escapeHtml(meta.label)}${meta.databaseId ? ' <span class="db-mark">DB</span>' : ''}</span>
      </span>
      <span class="side-count">${count}</span>`;
    frag.appendChild(el);
  }
  container.replaceChildren(frag);
  return shown;
}
