import './style.css';
import { state, persistNotes, ensureTopic, syncTopicsFromNotion } from './state';
import { extractRow, schemaForAi, toNotionDate, type AiExtraction } from './lib/extract';
import { DEFAULT_TOPIC } from './data/seed';
import { parseInputToNotion } from './lib/parser';
import { KEYS, getItem, setItem } from './lib/storage';
import { aiRoute, appendBlocks, createRow, deleteBlocks, fetchNotionSession, logoutNotion, setTodoChecked, OAUTH_LOGIN_URL } from './lib/api';
import { SlashMenu } from './ui/slash-menu';
import { renderNotes, renderSidebarTopics } from './ui/feed';
import { initGraph, stopGraph } from './ui/graph';
import type { NotionDatabase, NotionSession, View } from './types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  input: $<HTMLTextAreaElement>('note-input'),
  slash: $('slash-menu'),
  feed: $('notes-feed'),
  topics: $('topics-sidebar'),
  total: $('total-count'),
  mainColumn: $('main-column'),
  graphView: $('graph-view'),
  graphCanvas: $<HTMLCanvasElement>('neural-canvas'),
  graphCard: $('graph-card'),
  configView: $('config-view'),
  banner: $('topic-banner'),
  bannerText: $('topic-banner-text'),
  sidebar: $('right-sidebar'),
  collapseSvg: $('collapse-svg'),
  infoPopover: $('info-popover'),
  avatar: $('notion-avatar'),
  userName: $('notion-user-display'),
  wsStatus: $('notion-ws-status'),
  search: $<HTMLInputElement>('search-input'),
  cfgToken: $<HTMLInputElement>('cfg-notion-token'),
  cfgPage: $<HTMLInputElement>('cfg-notion-page'),
  cfgPageSelect: $<HTMLSelectElement>('cfg-notion-page-select'),
  cfgGemini: $<HTMLInputElement>('cfg-gemini-key'),
  cfgClaude: $<HTMLInputElement>('cfg-claude-key'),
  oauthStatus: $('oauth-status'),
  oauthLogin: $<HTMLButtonElement>('btn-oauth-login'),
  oauthLogout: $<HTMLButtonElement>('btn-oauth-logout'),
  cfgTasksDb: $<HTMLSelectElement>('cfg-tasks-db'),
  cfgAiFill: $<HTMLInputElement>('cfg-ai-fill'),
  notionSectionBtn: $('btn-notion-section'),
  notionSectionCount: $('notion-section-count')
};

const slashMenu = new SlashMenu(el.input, el.slash);
let session: NotionSession | null = null;

/* ───────────── Render ───────────── */

function render(): void {
  const shown = renderSidebarTopics(el.topics, el.total);
  el.notionSectionCount.textContent = shown ? String(shown) : '';
  if (state.activeView === 'stream' || state.activeView === 'topic') renderNotes(el.feed);
}

function setView(view: View): void {
  state.activeView = view;
  state.activeTopic = null;

  document.querySelectorAll('.side-link').forEach((n) => n.classList.remove('active'));
  if (view === 'stream') $('nav-stream').classList.add('active');
  if (view === 'graph') $('nav-graph').classList.add('active');
  if (view === 'config') $('nav-config').classList.add('active');

  el.mainColumn.classList.toggle('hidden', view !== 'stream');
  el.graphView.classList.toggle('active', view === 'graph');
  el.configView.classList.toggle('active', view === 'config');
  el.banner.classList.remove('visible');

  if (view === 'graph') initGraph(el.graphCanvas, el.graphCard);
  else stopGraph();
  render();
}

function selectTopic(key: string): void {
  const meta = ensureTopic(key, { label: key, notionDest: `Page / ${key}`, bg: 'var(--pastel-blue-bg)', fg: 'var(--pastel-blue-fg)', dot: '#6384e0' });
  state.activeView = 'topic';
  state.activeTopic = key;
  stopGraph();

  document.querySelectorAll('.side-link').forEach((n) => n.classList.remove('active'));
  el.mainColumn.classList.remove('hidden');
  el.graphView.classList.remove('active');
  el.configView.classList.remove('active');
  el.banner.classList.add('visible');
  el.bannerText.textContent = `${meta.label} — ${meta.notionDest}`;
  render();
}

async function toggleTask(id: number): Promise<void> {
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;
  note.done = !note.done;
  persistNotes();
  render();
  const blockId = note.notionBlockIds?.[0];
  if (!session || !blockId) return pulseSync();
  await withStatus(() => setTodoChecked(blockId, !!note.done, note.notionDoneProp), 'Notion • Error al marcar');
}

/** Borra una nota de Senda y, si se envió a Notion, también sus bloques allí. */
async function deleteNote(id: number): Promise<void> {
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;
  state.notes = state.notes.filter((n) => n.id !== id);
  persistNotes();
  render();
  const ids = note.notionBlockIds || [];
  if (!session || ids.length === 0) return;
  await withStatus(() => deleteBlocks(ids), 'Notion • Error al borrar');
}

/** Primer toque: el botón pide confirmación; segundo toque (en 3 s): borra. */
function handleDeleteClick(btn: HTMLElement): void {
  if (btn.classList.contains('confirm')) {
    void deleteNote(Number(btn.dataset.deleteId));
    return;
  }
  document.querySelectorAll('.note-delete.confirm').forEach((b) => b.classList.remove('confirm'));
  btn.classList.add('confirm');
  btn.title = 'Toca otra vez para borrar';
  setTimeout(() => {
    btn.classList.remove('confirm');
    btn.title = 'Borrar';
  }, 3000);
}

/* ───────────── Indicador de sincronización ───────────── */

const STATUS_OK = 'Notion • Conectado';
const STATUS_OFF = 'Notion • Sin conectar';

function idleStatus(): string {
  return session ? STATUS_OK : STATUS_OFF;
}

function pulseSync(): void {
  el.avatar.classList.add('syncing');
  el.wsStatus.textContent = 'Sincronizando...';
  setTimeout(() => {
    el.avatar.classList.remove('syncing');
    el.wsStatus.textContent = idleStatus();
  }, 650);
}

/** Ejecuta una operación contra Notion mostrando su estado real en la píldora. */
async function withStatus<T>(op: () => Promise<T>, errorText: string): Promise<T> {
  el.avatar.classList.add('syncing');
  el.wsStatus.textContent = 'Sincronizando...';
  const result = await op();
  el.avatar.classList.remove('syncing');
  const ok = Array.isArray(result) || result === true;
  el.wsStatus.textContent = ok ? STATUS_OK : errorText;
  if (!ok) setTimeout(() => (el.wsStatus.textContent = idleStatus()), 2500);
  return result;
}

/** Envía bloques a Notion y guarda en la nota los IDs creados. */
async function pushBlocks(noteId: number, blocks: Parameters<typeof appendBlocks>[0], topic?: string): Promise<void> {
  if (!session || blocks.length === 0) {
    pulseSync();
    return;
  }
  // @tema de una página de Notion → esa página; si no, la página destino configurada
  const pageId = (topic && state.topics[topic]?.pageId) || getItem(KEYS.notionPage);
  const ids = await withStatus(() => appendBlocks(blocks, pageId), 'Notion • Error al enviar');
  const note = state.notes.find((n) => n.id === noteId);
  if (ids && note) {
    note.notionBlockIds = ids;
    persistNotes();
  }
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || 'N';
}

/* ───────────── Sesión de Notion (OAuth / token) ───────────── */

async function loadSession(): Promise<void> {
  session = await fetchNotionSession();

  if (session) {
    el.userName.textContent = session.user.name;
    el.avatar.textContent = initials(session.user.name);
    syncTopicsFromNotion(session.pages, session.databases);
    render();
  }
  el.wsStatus.textContent = idleStatus();
  el.avatar.classList.toggle('offline', !session);

  const viaOAuth = session?.source === 'oauth';
  el.oauthStatus.textContent = session
    ? `Conectado${session.workspace ? ` a ${session.workspace}` : ''}${viaOAuth ? '' : session.source === 'token' ? ' (token manual)' : ' (servidor)'}`
    : 'Sin conectar';
  el.oauthStatus.classList.toggle('connected', !!session);
  el.oauthLogin.textContent = viaOAuth ? 'Reconectar' : 'Conectar con Notion';
  el.oauthLogout.classList.toggle('hidden', !viaOAuth);

  fillPageSelect();
  fillTasksDbSelect();
}

function fillTasksDbSelect(): void {
  const dbs = session?.databases || [];
  const current = getItem(KEYS.tasksDb);
  el.cfgTasksDb.replaceChildren(
    new Option('Ninguna: casilla en la página destino', ''),
    ...dbs.map((d) => new Option(d.title, d.id, false, d.id === current))
  );
  el.cfgAiFill.checked = !!getItem(KEYS.aiFill);
}

function fillPageSelect(): void {
  const pages = session?.pages || [];
  const current = getItem(KEYS.notionPage);
  el.cfgPage.value = current;

  if (pages.length === 0) {
    el.cfgPageSelect.classList.add('hidden');
    el.cfgPage.classList.remove('hidden');
    return;
  }

  el.cfgPageSelect.replaceChildren(
    new Option('Página por defecto del servidor', ''),
    ...pages.map((p) => new Option(p.title, p.id, false, p.id.replace(/-/g, '') === current.replace(/-/g, ''))),
    new Option('Otra (pegar ID manualmente)…', '__manual__')
  );
  const known = !current || pages.some((p) => p.id.replace(/-/g, '') === current.replace(/-/g, ''));
  if (!known) el.cfgPageSelect.value = '__manual__';
  el.cfgPageSelect.classList.remove('hidden');
  el.cfgPage.classList.toggle('hidden', known);

  // Con OAuth y sin destino elegido, usamos la primera página compartida.
  if (!current && session?.source === 'oauth' && pages[0]) {
    setItem(KEYS.notionPage, pages[0].id);
    el.cfgPageSelect.value = pages[0].id;
  }
}

function handleOAuthReturn(): void {
  const params = new URLSearchParams(location.search);
  const result = params.get('notion');
  if (!result) return;
  history.replaceState(null, '', location.pathname + location.hash);
  if (result === 'error') {
    setView('config');
    el.oauthStatus.textContent = `No se pudo conectar: ${params.get('reason') || 'error desconocido'}`;
  }
}

async function saveApiConfig(): Promise<void> {
  const selected = el.cfgPageSelect.classList.contains('hidden') ? '__manual__' : el.cfgPageSelect.value;
  const page = selected === '__manual__' ? el.cfgPage.value.trim() : selected;

  const token = el.cfgToken.value.trim();
  if (token) setItem(KEYS.notionToken, token);
  setItem(KEYS.notionPage, page);
  setItem(KEYS.tasksDb, el.cfgTasksDb.value);
  setItem(KEYS.aiFill, el.cfgAiFill.checked ? '1' : '');
  if (el.cfgGemini.value.trim()) setItem(KEYS.gemini, el.cfgGemini.value.trim());
  if (el.cfgClaude.value.trim()) setItem(KEYS.claude, el.cfgClaude.value.trim());

  el.cfgToken.value = el.cfgGemini.value = el.cfgClaude.value = '';
  pulseSync();
  await loadSession();
  setView('stream');
}

/* ───────────── Envío del scratchpad ───────────── */

async function submitInput(): Promise<void> {
  const raw = el.input.value.trim();
  if (!raw) return;
  el.input.value = '';
  autosize();
  slashMenu.close();

  if (raw === '/eliminar') {
    if (state.notes.length > 0) await deleteNote(state.notes[0]!.id);
    return;
  }

  if (raw === '/duplicar') {
    if (state.notes.length > 0) {
      state.notes.unshift({ ...state.notes[0]!, id: Date.now(), time: 'Ahora (copia)', notionBlockIds: undefined });
      persistNotes();
      pulseSync();
      render();
    }
    return;
  }

  if (raw.startsWith('/mover')) {
    const target = raw.match(/@([a-zA-Z0-9_-]+)/);
    if (target && state.notes.length > 0) {
      const topic = target[1]!.toLowerCase();
      ensureTopic(topic);
      state.notes[0]!.topic = topic;
      persistNotes();
      pulseSync();
      render();
    }
    return;
  }

  const ai = raw.match(/^\/(gemini|claude|auto)\b\s*/i);
  if (ai) {
    await submitAi(ai[1]!.toLowerCase() as 'gemini' | 'claude' | 'auto', raw.slice(ai[0].length), raw);
    return;
  }

  const parsed = parseInputToNotion(raw, state.activeTopic || DEFAULT_TOPIC);

  // ¿Va a una base? @base explícito, o tarea con "Base de datos para tareas" configurada
  const db = targetDatabase(parsed.topic, parsed.blockType === 'todo');
  if (db && (parsed.blockType === 'todo' || parsed.blockType === 'text')) {
    await submitToDatabase(db, parsed.cleanText, parsed.blockType === 'todo');
    return;
  }

  ensureTopic(parsed.topic);

  const noteId = Date.now();
  state.notes.unshift({
    id: noteId,
    time: 'Ahora',
    topic: parsed.topic,
    blockType: parsed.blockType,
    done: false,
    text: parsed.cleanText || 'Nuevo bloque en Notion',
    code: parsed.codeBlock ?? null,
    links: []
  });
  persistNotes();
  render();
  void pushBlocks(noteId, parsed.notionBlocks, parsed.topic);
}

function targetDatabase(topic: string, isTask: boolean): NotionDatabase | undefined {
  const dbs = session?.databases || [];
  const explicit = state.topics[topic]?.databaseId;
  const id = explicit || (isTask ? getItem(KEYS.tasksDb) : '');
  return id ? dbs.find((d) => d.id === id) : undefined;
}

/** Texto plano para el título: sin marcas de Markdown. */
function plain(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/`(.+?)`/g, '$1').replace(/~(.+?)~/g, '$1');
}

/** Crea una fila en la base con las propiedades deducidas del texto (y de la IA si está activada). */
async function submitToDatabase(db: NotionDatabase, rawText: string, isTask: boolean): Promise<void> {
  const text = plain(rawText);
  const topic = Object.entries(state.topics).find(([, m]) => m.databaseId === db.id)?.[0] || DEFAULT_TOPIC;
  const now = new Date();
  const first = extractRow(text, db, now);
  const isTodo = isTask || !!first.doneProp;

  const noteId = Date.now();
  state.notes.unshift({
    id: noteId,
    time: 'Ahora',
    topic,
    blockType: isTodo ? 'todo' : 'text',
    done: false,
    text: first.title,
    chips: first.chips,
    notionDoneProp: first.doneProp,
    links: []
  });
  persistNotes();
  render();

  if (!session) return pulseSync();

  let row = first;
  if (getItem(KEYS.aiFill)) {
    el.avatar.classList.add('syncing');
    const ai = await aiRoute('extract', text, [], {
      schema: schemaForAi(db),
      today: toNotionDate(now, { h: now.getHours(), m: now.getMinutes() })
    });
    el.avatar.classList.remove('syncing');
    if (ai.parsed) {
      row = extractRow(text, db, now, ai.parsed as AiExtraction);
      const note = state.notes.find((n) => n.id === noteId);
      if (note) Object.assign(note, { text: row.title, chips: row.chips });
      render();
    }
  }

  const ids = await withStatus(() => createRow(db.id, row.properties), 'Notion • Error al enviar');
  const note = state.notes.find((n) => n.id === noteId);
  if (ids && note) {
    note.notionBlockIds = ids;
    persistNotes();
  }
}

function aiErrorText(model: string, code: string | undefined, detail: string): string {
  if (code === 'missing_key') return `Falta la llave de ${model}. Agrégala en **Personalizar** o como variable en Vercel.`;
  if (code === 'rejected') return `${model} rechazó la llave: *${detail}*. Revisa que sea correcta y tenga crédito.`;
  return `${model} está saturado o no responde en este momento. Prueba de nuevo en unos minutos. (*${detail}*)`;
}

async function submitAi(mode: 'gemini' | 'claude' | 'auto', query: string, raw: string): Promise<void> {
  const model = mode === 'claude' ? 'Claude' : 'Gemini';
  state.notes.unshift({ id: Date.now(), time: 'Ahora', topic: state.activeTopic || DEFAULT_TOPIC, blockType: 'text', text: query || raw, links: [] });
  persistNotes();
  render();

  el.avatar.classList.add('syncing');
  const data = await aiRoute(mode, query, Object.keys(state.topics));
  el.avatar.classList.remove('syncing');

  state.notes.unshift({
    id: Date.now() + 1,
    time: 'Ahora',
    topic: 'ai',
    isAI: true,
    model: data.model || model,
    text: data.error ? aiErrorText(model, data.code, data.error) : data.text || data.parsed?.summary || 'Procesado.',
    links: (data.parsed?.relatedTopics || []).filter((t) => state.topics[t])
  });
  persistNotes();
  pulseSync();
  render();
}

/* ───────────── Apariencia ───────────── */

function changeTheme(theme: string): void {
  if (theme === 'white') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll<HTMLElement>('.swatch-card').forEach((c) => c.classList.toggle('active', c.dataset.themeChoice === theme));
  setItem(KEYS.theme, theme === 'white' ? '' : theme);
}

function setSize(px: string): void {
  document.documentElement.style.setProperty('--font-size', px);
  setItem(KEYS.fontSize, px === '14.5px' ? '' : px);
}

function setSidebarCollapsed(collapsed: boolean): void {
  el.sidebar.classList.toggle('collapsed', collapsed);
  el.collapseSvg.innerHTML = collapsed
    ? '<polyline points="11 17 6 12 11 7"></polyline><polyline points="18 17 13 12 18 7"></polyline>'
    : '<polyline points="13 17 18 12 13 7"></polyline><polyline points="6 17 11 12 6 7"></polyline>';
  setItem(KEYS.sidebarCollapsed, collapsed ? '1' : '');
}

/* ───────────── Cajón lateral (móvil) ───────────── */

function setDrawer(open: boolean): void {
  document.body.classList.toggle('drawer-open', open);
}

$('btn-mobile-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  setDrawer(!document.body.classList.contains('drawer-open'));
});
$('drawer-backdrop').addEventListener('click', () => setDrawer(false));

/* ───────────── Sección "Notion" desplegable ───────────── */

function setNotionSection(open: boolean): void {
  el.topics.classList.toggle('collapsed', !open);
  el.notionSectionBtn.setAttribute('aria-expanded', String(open));
  setItem(KEYS.notionSectionOpen, open ? '1' : '');
}

el.notionSectionBtn.addEventListener('click', () => setNotionSection(el.topics.classList.contains('collapsed')));
setNotionSection(!!getItem(KEYS.notionSectionOpen));

/* ───────────── Eventos ───────────── */

// La caja crece con el texto (hasta su max-height) y vuelve a su tamaño al enviar
function autosize(): void {
  el.input.style.height = 'auto';
  el.input.style.height = `${el.input.scrollHeight}px`;
}
el.input.addEventListener('input', autosize);

el.input.addEventListener('keydown', (e) => {
  if (slashMenu.handleKey(e)) return;
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void submitInput();
  }
});

$('btn-send').addEventListener('click', () => void submitInput());
$('btn-save-config').addEventListener('click', () => void saveApiConfig());
$('btn-toggle-sidebar').addEventListener('click', () => setSidebarCollapsed(!el.sidebar.classList.contains('collapsed')));
$('notion-user-pill').addEventListener('click', () => {
  if (session) {
    pulseSync();
    void loadSession();
  } else {
    setView('config');
  }
});

el.oauthLogin.addEventListener('click', () => {
  location.href = OAUTH_LOGIN_URL;
});
el.oauthLogout.addEventListener('click', async () => {
  await logoutNotion();
  setItem(KEYS.notionPage, '');
  await loadSession();
});

el.cfgPageSelect.addEventListener('change', () => {
  el.cfgPage.classList.toggle('hidden', el.cfgPageSelect.value !== '__manual__');
});

$('btn-info').addEventListener('click', (e) => {
  e.stopPropagation();
  el.infoPopover.classList.toggle('open');
});

el.search.addEventListener('input', () => {
  state.searchText = el.search.value;
  if (state.activeView !== 'stream' && state.activeView !== 'topic') setView('stream');
  else render();
});

// Delegación global: data-view, data-topic, data-task-id, data-theme-choice, data-size
document.addEventListener('click', (e) => {
  el.infoPopover.classList.remove('open');
  const target = e.target as HTMLElement;

  const del = target.closest<HTMLElement>('[data-delete-id]');
  if (del) return handleDeleteClick(del);

  const task = target.closest<HTMLElement>('[data-task-id]');
  if (task) return void toggleTask(Number(task.dataset.taskId));

  const topic = target.closest<HTMLElement>('[data-topic]');
  if (topic?.dataset.topic) {
    setDrawer(false);
    return selectTopic(topic.dataset.topic);
  }

  const view = target.closest<HTMLElement>('[data-view]');
  if (view?.dataset.view) {
    setDrawer(false);
    return setView(view.dataset.view as View);
  }

  const theme = target.closest<HTMLElement>('[data-theme-choice]');
  if (theme?.dataset.themeChoice) return changeTheme(theme.dataset.themeChoice);

  const size = target.closest<HTMLElement>('[data-size]');
  if (size?.dataset.size) return setSize(size.dataset.size);
});

window.addEventListener('resize', () => {
  if (state.activeView === 'graph') initGraph(el.graphCanvas, el.graphCard);
});

/* ───────────── Arranque ───────────── */

changeTheme(getItem(KEYS.theme) || 'white');
if (getItem(KEYS.fontSize)) setSize(getItem(KEYS.fontSize));
if (getItem(KEYS.sidebarCollapsed)) setSidebarCollapsed(true);
render();
handleOAuthReturn();
void loadSession();
