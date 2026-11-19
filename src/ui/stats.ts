/**
 * Rendimiento: horas en curso y tareas completadas por día, agrupadas por un select
 * de la base de tareas (Ámbito, Categoría…). Todo sale del historial local de Hoy
 * (tramos "en curso" y completadas), que se sincroniza entre dispositivos.
 */
import { formatDuration, localDay, type DoneEntry, type TaskTime, type TimeSegment } from './today';

export interface StatsHistory {
  log: TimeSegment[];
  done: DoneEntry[];
  time: Record<string, TaskTime>;
}

export interface GroupProp {
  name: string;
  options: string[];
}

export interface StatsSource {
  history: StatsHistory;
  props: GroupProp[];
  defaultProp: string;
}

export interface DayStat {
  key: string;
  date: Date;
  ms: Map<string, number>;
  done: Map<string, number>;
  totalMs: number;
  totalDone: number;
}

export interface Stats {
  days: DayStat[];
  groups: string[];
  byGroup: Map<string, number>;
  top: { id: string; title: string; ms: number }[];
  todayMs: number;
  weekMs: number;
  weekDone: number;
}

export const UNASSIGNED = 'Sin asignar';
export const OTHER = 'Otros';
const MAX_SLOTS = 7;
const DAY = 86_400_000;

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function nextDay(t: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Lunes de la semana de `t` (semana laboral argentina: lunes a domingo) */
function startOfWeek(t: number): number {
  const d = new Date(startOfDay(t));
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

/** Parte un tramo en pedazos por día local: [díaKey, ms][] */
export function splitByDay(seg: TimeSegment): [string, number][] {
  const out: [string, number][] = [];
  let a = seg.a;
  while (a < seg.b) {
    const end = Math.min(seg.b, nextDay(a));
    out.push([localDay(new Date(a)), end - a]);
    a = end;
  }
  return out;
}

function groupOf(g: Record<string, string[]> | undefined, prop: string): string {
  return g?.[prop]?.[0] || UNASSIGNED;
}

export function computeStats(h: StatsHistory, prop: string, options: string[], range: number, now = Date.now()): Stats {
  const first = startOfDay(now) - (range - 1) * DAY;
  const days: DayStat[] = [];
  const index = new Map<string, DayStat>();
  for (let i = 0; i < range; i++) {
    const date = new Date(first);
    date.setDate(date.getDate() + i);
    const day: DayStat = { key: localDay(date), date, ms: new Map(), done: new Map(), totalMs: 0, totalDone: 0 };
    days.push(day);
    index.set(day.key, day);
  }

  const raw = new Map<string, number>();
  const perTask = new Map<string, number>();
  const weekStart = startOfWeek(now);
  const todayKey = localDay(new Date(now));
  let todayMs = 0;
  let weekMs = 0;
  let weekDone = 0;

  for (const seg of h.log) {
    const group = groupOf(h.time[seg.i]?.g, prop);
    for (const [key, ms] of splitByDay(seg)) {
      if (key === todayKey) todayMs += ms;
      const day = index.get(key);
      if (!day) continue;
      day.ms.set(group, (day.ms.get(group) || 0) + ms);
      day.totalMs += ms;
      raw.set(group, (raw.get(group) || 0) + ms);
      perTask.set(seg.i, (perTask.get(seg.i) || 0) + ms);
    }
    weekMs += Math.max(0, seg.b - Math.max(seg.a, weekStart));
  }
  for (const d of h.done) {
    if (d.d >= weekStart) weekDone++;
    const day = index.get(localDay(new Date(d.d)));
    if (!day) continue;
    const group = groupOf(d.g || h.time[d.i]?.g, prop);
    day.done.set(group, (day.done.get(group) || 0) + 1);
    day.totalDone++;
    if (!raw.has(group)) raw.set(group, 0);
  }

  // Orden estable por entidad (orden de las opciones en Notion), no por ranking:
  // así el color de "Trabajo" no cambia al cambiar el rango.
  const known = options.filter((o) => raw.has(o));
  const extra = [...raw.keys()].filter((g) => g !== UNASSIGNED && !options.includes(g)).sort((a, b) => a.localeCompare(b));
  let groups = [...known, ...extra];
  if (groups.length > MAX_SLOTS) {
    const keep = new Set(groups.slice(0, MAX_SLOTS - 1));
    const fold = (m: Map<string, number>) => {
      for (const [g, v] of [...m]) {
        if (keep.has(g) || g === UNASSIGNED) continue;
        m.delete(g);
        m.set(OTHER, (m.get(OTHER) || 0) + v);
      }
    };
    for (const d of days) {
      fold(d.ms);
      fold(d.done);
    }
    fold(raw);
    groups = [...keep, OTHER];
  }
  if (raw.has(UNASSIGNED)) groups.push(UNASSIGNED);

  const top = [...perTask]
    .map(([id, ms]) => ({ id, title: h.time[id]?.n || 'Tarea sin título', ms }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5);

  return { days, groups, byGroup: raw, top, todayMs, weekMs, weekDone };
}

/* ───────────── Dibujo ───────────── */

const SVG = 'http://www.w3.org/2000/svg';
const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

/** Color del grupo: slot fijo por posición en `groups` (que ya sigue a la entidad) */
function colorOf(groups: string[], g: string): string {
  if (g === UNASSIGNED) return 'var(--viz-neutral)';
  if (g === OTHER) return 'var(--viz-other)';
  return `var(--viz-${(groups.indexOf(g) % 8) + 1})`;
}

/** Escala "linda": máximo y paso para ~4 líneas de grilla */
export function niceScale(max: number): { max: number; step: number } {
  if (max <= 0) return { max: 1, step: 1 };
  const rough = max / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) || 10 * mag;
  return { max: Math.ceil(max / step) * step, step };
}

function hours(ms: number): string {
  const v = ms / 3_600_000;
  return v >= 10 ? v.toFixed(0) : v.toFixed(1).replace('.0', '');
}

function dayLabel(d: Date, long = false): string {
  if (long) return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'short' });
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()}`;
}

interface ColumnChart {
  days: DayStat[];
  groups: string[];
  value: (d: DayStat, g: string) => number;
  total: (d: DayStat) => number;
  tick: (v: number) => string;
  format: (v: number) => string;
  /** Unidad mínima del eje (1 h, 1 tarea) para no mostrar 0,25 tareas */
  unit: number;
}

export class StatsPanel {
  private prop = '';
  private range = 14;
  private tables = new Set<string>();
  private tip: HTMLDivElement;
  private resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.onResize()) : null;
  private lastWidth = 0;

  constructor(
    private el: HTMLElement,
    private source: () => StatsSource
  ) {
    this.tip = h('div', 'viz-tip');
    this.tip.setAttribute('role', 'status');
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('change', (e) => {
      const t = e.target as HTMLSelectElement;
      if (t.dataset.statsProp !== undefined) {
        this.prop = t.value;
        this.render();
      }
    });
  }

  show(): void {
    this.resize?.observe(this.el);
    this.render();
  }

  hide(): void {
    this.resize?.disconnect();
    this.hideTip();
  }

  private onResize(): void {
    if (Math.abs(this.el.clientWidth - this.lastWidth) > 4) this.render();
  }

  private onClick(e: Event): void {
    const t = e.target as HTMLElement;
    const range = t.closest<HTMLElement>('[data-stats-range]');
    if (range) {
      this.range = Number(range.dataset.statsRange);
      return this.render();
    }
    const table = t.closest<HTMLElement>('[data-stats-table]');
    if (table) {
      const id = table.dataset.statsTable!;
      this.tables.has(id) ? this.tables.delete(id) : this.tables.add(id);
      this.render();
    }
  }

  render(): void {
    const width = this.el.clientWidth;
    if (!width) return;
    this.lastWidth = width;
    const src = this.source();
    if (!src.props.some((p) => p.name === this.prop)) this.prop = src.defaultProp || src.props[0]?.name || '';
    const options = src.props.find((p) => p.name === this.prop)?.options || [];
    const s = computeStats(src.history, this.prop, options, this.range);

    const root = h('div', 'stats-inner');
    root.append(this.header(src));
    root.append(this.tiles(s));

    const empty = !src.history.log.length && !src.history.done.length;
    if (empty) {
      root.append(
        h('p', 'stats-empty', 'Todavía no hay registros. Marcá una tarea como en curso (▶) en Hoy y Senda empieza a contar el tiempo; al completarla, suma a este gráfico.')
      );
    } else {
      root.append(
        this.card('hours', 'Horas en curso por día', s, {
          days: s.days,
          groups: s.groups,
          value: (d, g) => d.ms.get(g) || 0,
          total: (d) => d.totalMs,
          tick: (v) => `${hours(v)} h`,
          format: (v) => formatDuration(v),
          unit: 3_600_000
        })
      );
      root.append(
        this.card('done', 'Tareas completadas por día', s, {
          days: s.days,
          groups: s.groups,
          value: (d, g) => d.done.get(g) || 0,
          total: (d) => d.totalDone,
          tick: (v) => String(v),
          format: (v) => (v === 1 ? '1 tarea' : `${v} tareas`),
          unit: 1
        })
      );
      root.append(this.breakdown(s));
    }

    this.el.replaceChildren(root, this.tip);
  }

  private header(src: StatsSource): HTMLElement {
    const head = h('div', 'stats-head');
    const title = h('div');
    title.append(h('h2', 'stats-title', 'Rendimiento'), h('p', 'stats-sub', 'Tiempo en curso y tareas completadas, según lo que registrás en Hoy.'));
    const controls = h('div', 'stats-controls');
    if (src.props.length) {
      const label = h('label', 'stats-prop');
      label.append(h('span', '', 'Agrupar por'));
      const sel = h('select', 'config-input');
      sel.dataset.statsProp = '';
      for (const p of src.props) {
        const o = h('option', '', p.name);
        o.value = p.name;
        o.selected = p.name === this.prop;
        sel.append(o);
      }
      label.append(sel);
      controls.append(label);
    }
    const seg = h('div', 'stats-range');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Rango');
    for (const r of [7, 14, 30]) {
      const b = h('button', r === this.range ? 'active' : '', `${r} d`);
      b.type = 'button';
      b.dataset.statsRange = String(r);
      b.setAttribute('aria-pressed', String(r === this.range));
      seg.append(b);
    }
    controls.append(seg);
    head.append(title, controls);
    return head;
  }

  private tiles(s: Stats): HTMLElement {
    const row = h('div', 'stats-tiles');
    const worked = s.days.filter((d) => d.totalMs > 0).length;
    const avg = worked ? s.days.reduce((a, d) => a + d.totalMs, 0) / worked : 0;
    const items: [string, string][] = [
      ['En curso hoy', s.todayMs ? formatDuration(s.todayMs) : '—'],
      ['En curso esta semana', s.weekMs ? formatDuration(s.weekMs) : '—'],
      ['Completadas esta semana', String(s.weekDone)],
      ['Promedio por día trabajado', avg ? formatDuration(avg) : '—']
    ];
    for (const [label, value] of items) {
      const t = h('div', 'stats-tile');
      t.append(h('div', 'stats-tile-label', label), h('div', 'stats-tile-value', value));
      row.append(t);
    }
    return row;
  }

  private card(id: string, title: string, s: Stats, chart: ColumnChart): HTMLElement {
    const card = h('section', 'stats-card');
    const head = h('div', 'stats-card-head');
    head.append(h('h3', '', title));
    const btn = h('button', 'stats-table-btn', this.tables.has(id) ? 'Ver gráfico' : 'Ver tabla');
    btn.type = 'button';
    btn.dataset.statsTable = id;
    head.append(btn);
    card.append(head);
    const shown = s.groups.filter((g) => s.days.some((d) => chart.value(d, g) > 0));
    if (this.tables.has(id)) card.append(this.table(chart, shown));
    else {
      if (shown.length > 1) card.append(this.legend(s.groups, shown));
      card.append(this.columns(chart, s.groups, shown));
    }
    return card;
  }

  private legend(all: string[], shown: string[]): HTMLElement {
    const l = h('div', 'viz-legend');
    for (const g of shown) {
      const item = h('span', 'viz-legend-item');
      const sw = h('span', 'viz-swatch');
      sw.style.background = colorOf(all, g);
      item.append(sw, document.createTextNode(g));
      l.append(item);
    }
    return l;
  }

  private columns(c: ColumnChart, all: string[], shown: string[]): SVGSVGElement {
    const W = Math.max(280, this.lastWidth - 2 * 18 - 2);
    const H = 200;
    const pad = { l: 40, r: 6, t: 8, b: 26 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;
    const maxTotal = Math.max(...c.days.map(c.total), 0);
    let { max, step } = niceScale(maxTotal / c.unit);
    if (c.unit === 1 && step < 1) ({ max, step } = { max: Math.max(1, Math.ceil(max)), step: 1 });
    max *= c.unit;
    step *= c.unit;
    const y = (v: number) => pad.t + plotH - (v / max) * plotH;

    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', class: 'viz-svg', role: 'img' });
    root.setAttribute('aria-label', 'Gráfico de columnas por día. Usá “Ver tabla” para los valores.');

    for (let v = 0; v <= max + 1e-9; v += step) {
      root.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: v === 0 ? 'viz-base' : 'viz-grid' }));
      const t = svg('text', { x: pad.l - 6, y: y(v) + 3.5, class: 'viz-tick', 'text-anchor': 'end' });
      t.textContent = c.tick(v);
      root.append(t);
    }

    const band = plotW / c.days.length;
    const bw = Math.min(24, Math.max(4, band * 0.62));
    // Una etiqueta cada ~48px, contando desde "hoy" hacia atrás
    const labelEvery = Math.max(1, Math.ceil(48 / band));
    const GAP = 2;

    c.days.forEach((d, i) => {
      const cx = pad.l + band * i + band / 2;
      const x = cx - bw / 2;
      const segs = shown.map((g) => [g, c.value(d, g)] as const).filter(([, v]) => v > 0);
      let base = y(0);
      segs.forEach(([g, v], k) => {
        const hgt = (v / max) * plotH;
        const top = k === segs.length - 1;
        const y0 = base - (k > 0 ? GAP : 0);
        const y1 = Math.min(y0, base - hgt);
        const r = top ? Math.min(4, y0 - y1, bw / 2) : 0;
        if (y0 - y1 > 0.5) {
          const path = `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + bw - r} Q${x + bw},${y1} ${x + bw},${y1 + r} V${y0} Z`;
          root.append(svg('path', { d: path, fill: colorOf(all, g), class: 'viz-mark' }));
        }
        base -= hgt;
      });

      if (i % labelEvery === (c.days.length - 1) % labelEvery) {
        const t = svg('text', { x: cx, y: H - 8, class: 'viz-tick', 'text-anchor': 'middle' });
        t.textContent = i === c.days.length - 1 ? 'hoy' : dayLabel(d.date);
        root.append(t);
      }

      // Zona de hover: toda la columna del día (más grande que la barra)
      const hit = svg('rect', { x: pad.l + band * i, y: pad.t, width: band, height: plotH, class: 'viz-hit', tabindex: 0 });
      hit.setAttribute('aria-label', `${dayLabel(d.date, true)}: ${c.format(c.total(d))}`);
      const show = () => {
        root.querySelectorAll('.viz-hit.on').forEach((n) => n.classList.remove('on'));
        hit.classList.add('on');
        this.showTip(hit, d, c, all, shown);
      };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('focus', show);
      hit.addEventListener('pointerleave', () => {
        hit.classList.remove('on');
        this.hideTip();
      });
      hit.addEventListener('blur', () => {
        hit.classList.remove('on');
        this.hideTip();
      });
      root.append(hit);
    });
    return root;
  }

  private showTip(anchor: SVGRectElement, d: DayStat, c: ColumnChart, all: string[], shown: string[]): void {
    const tip = this.tip;
    tip.replaceChildren();
    tip.append(h('div', 'viz-tip-title', dayLabel(d.date, true)));
    const total = h('div', 'viz-tip-total', c.format(c.total(d)));
    tip.append(total);
    for (const g of shown) {
      const v = c.value(d, g);
      if (!v) continue;
      const row = h('div', 'viz-tip-row');
      const key = h('span', 'viz-tip-key');
      key.style.background = colorOf(all, g);
      row.append(key, h('strong', '', c.format(v)), h('span', 'viz-tip-name', g));
      tip.append(row);
    }
    tip.classList.add('on');
    const host = this.el.getBoundingClientRect();
    const r = anchor.getBoundingClientRect();
    const tw = tip.offsetWidth;
    // Al costado de la columna, para no tapar la barra que se está leyendo
    let left = r.right - host.left + this.el.scrollLeft + 6;
    if (left + tw > this.el.clientWidth - 8) left = r.left - host.left + this.el.scrollLeft - tw - 6;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${r.top - host.top + this.el.scrollTop}px`;
  }

  private hideTip(): void {
    this.tip.classList.remove('on');
  }

  private table(c: ColumnChart, shown: string[]): HTMLElement {
    const wrap = h('div', 'viz-table-wrap');
    const t = h('table', 'viz-table');
    const head = h('tr');
    head.append(h('th', '', 'Día'));
    for (const g of shown) head.append(h('th', '', g));
    head.append(h('th', '', 'Total'));
    t.append(head);
    for (const d of [...c.days].reverse()) {
      const tr = h('tr');
      tr.append(h('td', '', dayLabel(d.date, true)));
      for (const g of shown) {
        const v = c.value(d, g);
        tr.append(h('td', 'num', v ? c.format(v) : '—'));
      }
      const tot = c.total(d);
      tr.append(h('td', 'num strong', tot ? c.format(tot) : '—'));
      t.append(tr);
    }
    wrap.append(t);
    return wrap;
  }

  /** Reparto del rango por grupo y las tareas que más tiempo llevaron */
  private breakdown(s: Stats): HTMLElement {
    const grid = h('div', 'stats-grid');

    const byGroup = h('section', 'stats-card');
    byGroup.append(h('h3', '', 'Tiempo por ' + (this.prop || 'grupo').toLowerCase()));
    const total = [...s.byGroup.values()].reduce((a, b) => a + b, 0);
    const groups = s.groups.filter((g) => (s.byGroup.get(g) || 0) > 0);
    if (!groups.length) byGroup.append(h('p', 'stats-empty', 'Sin tiempo registrado en este rango.'));
    const maxG = Math.max(...groups.map((g) => s.byGroup.get(g) || 0), 1);
    for (const g of groups) {
      const ms = s.byGroup.get(g) || 0;
      byGroup.append(this.hbar(g, `${formatDuration(ms)} · ${Math.round((ms / total) * 100)}%`, ms / maxG, colorOf(s.groups, g)));
    }

    const top = h('section', 'stats-card');
    top.append(h('h3', '', 'Tareas con más tiempo'));
    if (!s.top.length) top.append(h('p', 'stats-empty', 'Sin tiempo registrado en este rango.'));
    const maxT = s.top[0]?.ms || 1;
    for (const t of s.top) top.append(this.hbar(t.title, formatDuration(t.ms), t.ms / maxT, 'var(--viz-1)'));

    grid.append(byGroup, top);
    return grid;
  }

  private hbar(label: string, value: string, frac: number, color: string): HTMLElement {
    const row = h('div', 'hbar');
    const text = h('div', 'hbar-text');
    text.append(h('span', 'hbar-label', label), h('span', 'hbar-value', value));
    const track = h('div', 'hbar-track');
    const fill = h('div', 'hbar-fill');
    fill.style.width = `${Math.max(2, frac * 100)}%`;
    fill.style.background = color;
    track.append(fill);
    row.append(text, track);
    row.title = `${label}: ${value}`;
    return row;
  }
}
