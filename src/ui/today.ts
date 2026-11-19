import { escapeHtml } from '../lib/markdown';
import type { TaskRow } from '../types';

export interface TodayOptions {
  /** Propiedad select que agrupa los botones (p. ej. "Ámbito") */
  groupProp: string;
  groupOptions: string[];
  /** id de fila relacionada → título (obras) */
  relTitles: Map<string, string>;
}

/** Preferencias propias de Senda (no se guardan en Notion): orden manual y tareas en curso */
export interface TodayPrefs {
  order: string[];
  doing: string[];
}

type SectionKey = 'doing' | 'overdue' | 'today' | 'future';

const pad = (n: number) => String(n).padStart(2, '0');

export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "2026-11-18" o "2026-11-18T08:00:00-03:00" → día local + hora (si tiene) */
function parseTaskDate(date: string): { day: string; time?: string } {
  if (date.length <= 10) return { day: date };
  const d = new Date(date);
  return { day: localDay(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/**
 * Orden manual: primero las que ordenaste (en ese orden), después el resto por fecha.
 * Lo que ordenas en una sección no desordena las demás.
 */
export function applyOrder(tasks: TaskRow[], order: string[]): TaskRow[] {
  const pos = new Map(order.map((id, i) => [id, i]));
  return [...tasks].sort((a, b) => {
    const pa = pos.get(a.id);
    const pb = pos.get(b.id);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;
    // Sin fecha, al final
    if (!a.date || !b.date) return a.date ? -1 : b.date ? 1 : 0;
    return a.date.localeCompare(b.date);
  });
}

/** Nuevo orden global tras reordenar una sección: esa sección en su orden nuevo, el resto igual. */
export function mergeOrder(order: string[], sectionIds: string[]): string[] {
  const inSection = new Set(sectionIds);
  const rest = order.filter((id) => !inSection.has(id));
  return [...sectionIds, ...rest];
}

/**
 * Vista "Hoy": en curso, vencidas, de hoy y a futuro, leídas de Notion.
 * Botones para filtrar por un select (Trabajo / Personal), casillas que marcan "Hecho",
 * asa ⋮⋮ para ordenar arrastrando y ▶ para marcar lo que estás haciendo.
 */
export class TodayPanel {
  private tasks: TaskRow[] = [];
  private opts: TodayOptions = { groupProp: '', groupOptions: [], relTitles: new Map() };
  private prefs: TodayPrefs = { order: [], doing: [] };
  private active = '';
  private collapsed = false;
  private loaded = false;
  private leaving = new Set<string>();
  private query = '';
  /** Grupos desplegables: vencidas y a futuro (cerrados por defecto) */
  private open: Record<'overdue' | 'future', boolean> = { overdue: false, future: false };
  private dragging = false;

  constructor(
    private readonly el: HTMLElement,
    private readonly onToggle: (task: TaskRow) => void,
    private readonly store: { get: (k: string) => string; set: (k: string, v: string) => void },
    private readonly onPrefs: (prefs: TodayPrefs) => void = () => {}
  ) {
    this.active = store.get('group');
    this.collapsed = store.get('collapsed') === '1';
    this.open = { overdue: store.get('overdueOpen') === '1', future: store.get('futureOpen') === '1' };

    el.addEventListener('click', (e) => {
      if (this.dragging) return;
      const t = e.target as HTMLElement;
      const group = t.closest<HTMLElement>('[data-today-group]');
      if (group) {
        const g = group.dataset.todayGroup!;
        this.active = this.active === g ? '' : g;
        this.store.set('group', this.active);
        return this.render();
      }
      const section = t.closest<HTMLElement>('[data-today-section]');
      if (section) {
        const key = section.dataset.todaySection as 'overdue' | 'future';
        this.open[key] = !this.open[key];
        this.store.set(key === 'overdue' ? 'overdueOpen' : 'futureOpen', this.open[key] ? '1' : '');
        return this.render();
      }
      if (t.closest('[data-today-toggle]')) {
        this.collapsed = !this.collapsed;
        this.store.set('collapsed', this.collapsed ? '1' : '');
        return this.render();
      }
      const doing = t.closest<HTMLElement>('[data-today-doing]');
      if (doing) return this.toggleDoing(doing.dataset.todayDoing!);
      const check = t.closest<HTMLElement>('[data-today-task]');
      if (check) {
        const task = this.tasks.find((x) => x.id === check.dataset.todayTask);
        if (!task) return;
        this.leaving.add(task.id);
        this.render();
        this.onToggle(task);
      }
    });

    el.addEventListener('pointerdown', (e) => this.startDrag(e));
  }

  hide(): void {
    this.el.classList.add('hidden');
  }

  /** Filtra por texto (el buscador también busca en Hoy) */
  setQuery(q: string): void {
    this.query = q.trim().toLowerCase();
    this.render();
  }

  setPrefs(prefs: TodayPrefs): void {
    this.prefs = { order: [...prefs.order], doing: [...prefs.doing] };
    this.render();
  }

  setData(tasks: TaskRow[], opts: TodayOptions): void {
    this.tasks = tasks;
    this.opts = opts;
    this.loaded = true;
    this.leaving = new Set([...this.leaving].filter((id) => tasks.some((t) => t.id === id)));
    if (this.active && !opts.groupOptions.includes(this.active)) this.active = '';
    // Tareas terminadas o borradas en Notion salen de "En curso" y del orden
    const ids = new Set(tasks.map((t) => t.id));
    const doing = this.prefs.doing.filter((id) => ids.has(id));
    const order = this.prefs.order.filter((id) => ids.has(id));
    if (doing.length !== this.prefs.doing.length || order.length !== this.prefs.order.length) {
      this.prefs = { order, doing };
      this.onPrefs(this.prefs);
    }
    this.render();
  }

  /** Quita una tarea marcada como hecha (o la devuelve si falló) */
  settle(id: string, done: boolean): void {
    if (done) {
      this.tasks = this.tasks.filter((t) => t.id !== id);
      if (this.prefs.doing.includes(id)) {
        this.prefs = { ...this.prefs, doing: this.prefs.doing.filter((x) => x !== id) };
        this.onPrefs(this.prefs);
      }
    }
    this.leaving.delete(id);
    this.render();
  }

  /** Todas las pendientes (para dar contexto a Gemini), con las "en curso" marcadas */
  all(): TaskRow[] {
    return this.tasks;
  }

  isDoing(id: string): boolean {
    return this.prefs.doing.includes(id);
  }

  private toggleDoing(id: string): void {
    const on = !this.prefs.doing.includes(id);
    this.prefs = { ...this.prefs, doing: on ? [...this.prefs.doing, id] : this.prefs.doing.filter((x) => x !== id) };
    this.onPrefs(this.prefs);
    this.render();
  }

  /* ───────────── Arrastrar para ordenar ───────────── */

  private startDrag(e: PointerEvent): void {
    const handle = (e.target as HTMLElement).closest<HTMLElement>('[data-drag]');
    if (!handle) return;
    const row = handle.closest<HTMLElement>('.today-task');
    const list = row?.parentElement;
    if (!row || !list) return;
    e.preventDefault();
    // Se escucha en la ventana: mover la fila en el DOM anula la captura del puntero
    row.classList.add('dragging');
    document.body.classList.add('is-dragging');
    this.dragging = true;
    const section = row.dataset.section;

    const move = (ev: PointerEvent) => {
      const siblings = [...list.querySelectorAll<HTMLElement>(`.today-task[data-section="${section}"]`)].filter((s) => s !== row);
      const after = siblings.find((s) => {
        const r = s.getBoundingClientRect();
        return ev.clientY < r.top + r.height / 2;
      });
      if (after) list.insertBefore(row, after);
      else if (siblings.length) siblings[siblings.length - 1]!.after(row);
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      row.classList.remove('dragging');
      document.body.classList.remove('is-dragging');
      const ids = [...list.querySelectorAll<HTMLElement>(`.today-task[data-section="${section}"]`)].map((r) => r.dataset.id!);
      this.prefs = { ...this.prefs, order: mergeOrder(this.prefs.order, ids) };
      this.onPrefs(this.prefs);
      // Evita que el "click" posterior al soltar marque algo
      setTimeout(() => (this.dragging = false), 0);
      this.render();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  /* ───────────── Dibujo ───────────── */

  render(): void {
    if (!this.loaded) return this.hide();
    this.el.classList.remove('hidden');
    const today = localDay();
    const inGroup = (t: TaskRow) =>
      (!this.active || (t.selects[this.opts.groupProp] || []).includes(this.active)) &&
      (!this.query || t.title.toLowerCase().includes(this.query));
    const doingSet = new Set(this.prefs.doing);

    const visible = applyOrder(this.tasks.filter(inGroup), this.prefs.order);
    const doing = visible.filter((t) => doingSet.has(t.id));
    const dated = visible.filter((t) => t.date && !doingSet.has(t.id));
    const overdue = dated.filter((t) => parseTaskDate(t.date!).day < today);
    const todays = dated.filter((t) => parseTaskDate(t.date!).day === today);
    const future = dated.filter((t) => parseTaskDate(t.date!).day > today);

    const all = this.tasks.filter((t) => t.date || doingSet.has(t.id));
    const count = (g: string) => all.filter((t) => (t.selects[this.opts.groupProp] || []).includes(g)).length;
    const buttons = this.opts.groupOptions.length
      ? `<div class="today-groups">${this.opts.groupOptions
          .map(
            (g) => `<button class="today-group ${this.active === g ? 'active' : ''}" data-today-group="${escapeHtml(g)}">
                      ${escapeHtml(g)} <span>${count(g)}</span>
                    </button>`
          )
          .join('')}</div>`
      : '';

    const item = (t: TaskRow, section: SectionKey) => {
      const date = t.date ? parseTaskDate(t.date) : null;
      const dd = date ? escapeHtml(date.day.slice(8, 10) + '/' + date.day.slice(5, 7)) : '';
      const late = !!date && date.day < today;
      const showDay = date && (section === 'overdue' || section === 'future' || (section === 'doing' && date.day !== today));
      const chips = [
        showDay ? `<span class="today-chip ${late ? 'late' : ''}">${dd}</span>` : '',
        date?.time ? `<span class="today-chip">${date.time}</span>` : '',
        ...Object.entries(t.selects)
          .filter(([p]) => p !== this.opts.groupProp)
          .flatMap(([, v]) => v)
          .map((v) => `<span class="today-chip">${escapeHtml(v)}</span>`),
        ...Object.values(t.relations)
          .flat()
          .map((id) => this.opts.relTitles.get(id))
          .filter(Boolean)
          .map((title) => `<span class="today-chip">↗ ${escapeHtml(title!)}</span>`)
      ].join('');
      const leaving = this.leaving.has(t.id);
      const isDoing = doingSet.has(t.id);
      return `<div class="today-task ${leaving ? 'leaving' : ''} ${isDoing ? 'doing' : ''}" data-id="${t.id}" data-section="${section}">
          <span class="today-drag" data-drag title="Arrastrar para ordenar" aria-label="Ordenar">
            <svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>
          </span>
          <button class="checkbox-ui ${leaving ? 'checked' : ''}" data-today-task="${t.id}" aria-label="Marcar hecha">${leaving ? '✓' : ''}</button>
          <div class="today-task-body">
            <a class="today-title" href="${escapeHtml(t.url)}" target="_blank" rel="noopener">${escapeHtml(t.title)}</a>
            ${chips ? `<div class="today-chips">${chips}</div>` : ''}
          </div>
          <button class="today-doing-btn ${isDoing ? 'on' : ''}" data-today-doing="${t.id}"
                  title="${isDoing ? 'Quitar de En curso' : 'Marcar En curso'}" aria-label="${isDoing ? 'Quitar de En curso' : 'Marcar En curso'}">
            ${isDoing
              ? '<svg viewBox="0 0 24 24"><rect x="7" y="6" width="3.5" height="12" rx="1"/><rect x="13.5" y="6" width="3.5" height="12" rx="1"/></svg>'
              : '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>'}
          </button>
        </div>`;
    };

    // En curso y Hoy siempre a la vista; Vencidas y A futuro se despliegan
    const doingBlock = doing.length
      ? `<div class="today-label doing">En curso · ${doing.length}</div>${doing.map((t) => item(t, 'doing')).join('')}`
      : '';
    const section = (key: 'overdue' | 'future', label: string, list: TaskRow[]) =>
      list.length
        ? `<button class="today-label today-section ${key === 'overdue' ? 'late' : ''}" data-today-section="${key}" aria-expanded="${this.open[key]}">
             <svg class="nav-svg side-chevron" viewBox="0 0 24 24"><polyline points="9 6 15 12 9 18"></polyline></svg>
             ${label} · ${list.length}
           </button>
           ${this.open[key] ? list.map((t) => item(t, key)).join('') : ''}`
        : '';
    const todayBlock = todays.length
      ? `<div class="today-label">Hoy · ${todays.length}</div>${todays.map((t) => item(t, 'today')).join('')}`
      : `<div class="today-empty">${this.active ? `Nada en ${escapeHtml(this.active)} para hoy` : 'Nada pendiente para hoy'} ✓</div>`;
    const body = `${doingBlock}${section('overdue', 'Vencidas', overdue)}${todayBlock}${section('future', 'A futuro', future)}`;

    this.el.innerHTML = `
      <button class="today-header" data-today-toggle aria-expanded="${!this.collapsed}">
        <span class="today-heading">Hoy <span class="today-count">${todays.length}</span>${doing.length ? `<span class="today-doing-count">▶ ${doing.length}</span>` : ''}</span>
        <svg class="nav-svg side-chevron" viewBox="0 0 24 24"><polyline points="9 6 15 12 9 18"></polyline></svg>
      </button>
      ${this.collapsed ? '' : `${buttons}<div class="today-list">${body}</div>`}`;
  }
}
