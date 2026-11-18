import { escapeHtml } from '../lib/markdown';
import type { TaskRow } from '../types';

export interface TodayOptions {
  /** Propiedad select que agrupa los botones (p. ej. "Ámbito") */
  groupProp: string;
  groupOptions: string[];
  /** id de fila relacionada → título (obras) */
  relTitles: Map<string, string>;
}

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
 * Vista "Hoy": tareas de hoy y vencidas, leídas de Notion, con botones para
 * filtrar por un select (Trabajo / Personal) y casillas que marcan "Hecho".
 */
export class TodayPanel {
  private tasks: TaskRow[] = [];
  private opts: TodayOptions = { groupProp: '', groupOptions: [], relTitles: new Map() };
  private active = '';
  private collapsed = false;
  private loaded = false;
  private leaving = new Set<string>();
  private query = '';
  /** Grupos desplegables: vencidas y a futuro (cerrados por defecto) */
  private open: Record<'overdue' | 'future', boolean> = { overdue: false, future: false };

  constructor(
    private readonly el: HTMLElement,
    private readonly onToggle: (task: TaskRow) => void,
    private readonly store: { get: (k: string) => string; set: (k: string, v: string) => void }
  ) {
    this.active = store.get('group');
    this.collapsed = store.get('collapsed') === '1';
    this.open = { overdue: store.get('overdueOpen') === '1', future: store.get('futureOpen') === '1' };
    el.addEventListener('click', (e) => {
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
      const check = t.closest<HTMLElement>('[data-today-task]');
      if (check) {
        const task = this.tasks.find((x) => x.id === check.dataset.todayTask);
        if (!task) return;
        this.leaving.add(task.id);
        this.render();
        this.onToggle(task);
      }
    });
  }

  /** Filtra por texto (el buscador también busca en Hoy) */
  setQuery(q: string): void {
    this.query = q.trim().toLowerCase();
    this.render();
  }

  hide(): void {
    this.el.classList.add('hidden');
  }

  setData(tasks: TaskRow[], opts: TodayOptions): void {
    this.tasks = tasks;
    this.opts = opts;
    this.loaded = true;
    this.leaving = new Set([...this.leaving].filter((id) => tasks.some((t) => t.id === id)));
    if (this.active && !opts.groupOptions.includes(this.active)) this.active = '';
    this.render();
  }

  /** Quita una tarea marcada como hecha (o la devuelve si falló) */
  settle(id: string, done: boolean): void {
    if (done) this.tasks = this.tasks.filter((t) => t.id !== id);
    this.leaving.delete(id);
    this.render();
  }

  /** Todas las pendientes (para dar contexto a Gemini) */
  all(): TaskRow[] {
    return this.tasks;
  }

  render(): void {
    if (!this.loaded) return this.hide();
    this.el.classList.remove('hidden');
    const today = localDay();
    const inGroup = (t: TaskRow) =>
      (!this.active || (t.selects[this.opts.groupProp] || []).includes(this.active)) &&
      (!this.query || t.title.toLowerCase().includes(this.query));
    const dated = this.tasks.filter((t) => t.date);
    const visible = dated.filter(inGroup);
    const overdue = visible.filter((t) => parseTaskDate(t.date!).day < today);
    const todays = visible.filter((t) => parseTaskDate(t.date!).day === today);
    const future = visible.filter((t) => parseTaskDate(t.date!).day > today);

    const count = (g: string) => dated.filter((t) => (t.selects[this.opts.groupProp] || []).includes(g)).length;
    const buttons = this.opts.groupOptions.length
      ? `<div class="today-groups">${this.opts.groupOptions
          .map(
            (g) => `<button class="today-group ${this.active === g ? 'active' : ''}" data-today-group="${escapeHtml(g)}">
                      ${escapeHtml(g)} <span>${count(g)}</span>
                    </button>`
          )
          .join('')}</div>`
      : '';

    const item = (t: TaskRow, when: 'late' | 'today' | 'future') => {
      const { time, day } = parseTaskDate(t.date!);
      const dd = escapeHtml(day.slice(8, 10) + '/' + day.slice(5, 7));
      const chips = [
        when === 'late' ? `<span class="today-chip late">${dd}</span>` : when === 'future' ? `<span class="today-chip">${dd}</span>` : '',
        time ? `<span class="today-chip">${time}</span>` : '',
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
      return `<div class="today-task ${leaving ? 'leaving' : ''}">
          <button class="checkbox-ui ${leaving ? 'checked' : ''}" data-today-task="${t.id}" aria-label="Marcar hecha">${leaving ? '✓' : ''}</button>
          <div class="today-task-body">
            <a class="today-title" href="${escapeHtml(t.url)}" target="_blank" rel="noopener">${escapeHtml(t.title)}</a>
            ${chips ? `<div class="today-chips">${chips}</div>` : ''}
          </div>
        </div>`;
    };

    // Vencidas y A futuro se despliegan; Hoy siempre a la vista
    const section = (key: 'overdue' | 'future', label: string, list: TaskRow[], when: 'late' | 'future') =>
      list.length
        ? `<button class="today-label today-section ${when === 'late' ? 'late' : ''}" data-today-section="${key}" aria-expanded="${this.open[key]}">
             <svg class="nav-svg side-chevron" viewBox="0 0 24 24"><polyline points="9 6 15 12 9 18"></polyline></svg>
             ${label} · ${list.length}
           </button>
           ${this.open[key] ? list.map((t) => item(t, when)).join('') : ''}`
        : '';
    const todayBlock = todays.length
      ? `<div class="today-label">Hoy · ${todays.length}</div>${todays.map((t) => item(t, 'today')).join('')}`
      : `<div class="today-empty">${this.active ? `Nada en ${escapeHtml(this.active)} para hoy` : 'Nada pendiente para hoy'} ✓</div>`;
    const body = `${section('overdue', 'Vencidas', overdue, 'late')}${todayBlock}${section('future', 'A futuro', future, 'future')}`;

    this.el.innerHTML = `
      <button class="today-header" data-today-toggle aria-expanded="${!this.collapsed}">
        <span class="today-heading">Hoy <span class="today-count">${todays.length}</span></span>
        <svg class="nav-svg side-chevron" viewBox="0 0 24 24"><polyline points="9 6 15 12 9 18"></polyline></svg>
      </button>
      ${this.collapsed ? '' : `${buttons}<div class="today-list">${body}</div>`}`;
  }
}
