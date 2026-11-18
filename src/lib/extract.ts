import type { DbProperty, NotionDatabase } from '../types';

/**
 * Convierte texto libre en propiedades de una base de Notion, sin IA:
 *   "mañana 8h recibir H-30 en PJC #urgente"
 *   → Tarea: "Recibir H-30 en PJC", Fecha: mañana 08:00, Categoría: 🔥 Urgente, Obra: PJC
 *
 * - Fecha/hora en español: hoy, mañana, pasado mañana, días de la semana, 19/11, "en 3 días", 8h, 8:30, a las 9.
 * - Selects/estado: #etiqueta que coincida con el comienzo de una opción (#urgente, #master, #personal).
 * - Relaciones: el texto menciona el título o una palabra clave de la fila relacionada (PJC, Olimpia…).
 */

export interface ExtractedRow {
  title: string;
  properties: Record<string, unknown>;
  chips: string[];
  /** Casilla que representa "hecho" (para sincronizar el check desde Senda). */
  doneProp?: string;
}

export interface AiExtraction {
  title?: string;
  date?: string | null;
  selects?: Record<string, string | string[] | null>;
  relations?: Record<string, string[] | null>;
}

/** minúsculas, sin tildes ni emojis, solo letras/números/espacios */
export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const WD_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

const pad = (n: number) => String(n).padStart(2, '0');

function addDays(d: Date, n: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}

/** ISO local con desplazamiento (p. ej. 2026-11-19T08:00:00-03:00), como lo espera Notion. */
export function toNotionDate(day: Date, time?: { h: number; m: number }): string {
  const date = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
  if (!time) return date;
  const local = new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.h, time.m);
  const off = -local.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${date}T${pad(time.h)}:${pad(time.m)}:00${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

function chipForDate(day: Date, time: { h: number; m: number } | undefined, now: Date): string {
  const diff = Math.round((addDays(day, 0).getTime() - addDays(now, 0).getTime()) / 86400000);
  const label = diff === 0 ? 'hoy' : diff === 1 ? 'mañana' : `${WD_SHORT[day.getDay()]} ${day.getDate()}/${day.getMonth() + 1}`;
  return `📅 ${label}${time ? ` ${pad(time.h)}:${pad(time.m)}` : ''}`;
}

interface DateHit {
  day?: Date;
  time?: { h: number; m: number };
  rest: string;
}

/** Busca fecha y hora en el texto y devuelve el texto sin esas expresiones. */
export function parseSpanishDate(text: string, now: Date): DateHit {
  let rest = ` ${text} `;
  let day: Date | undefined;
  let time: { h: number; m: number } | undefined;
  let afternoon = false;

  // Se lleva también el conector de delante ("para mañana", "hasta el viernes"),
  // para no dejar títulos como "Entregar planos para"
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    const withConnector = new RegExp(`(?:\\s(?:para|hasta|antes\\s+del?|desde|del|de|por))?${re.source}`, re.flags);
    const m = rest.match(withConnector);
    if (!m) return false;
    fn(m);
    rest = rest.replace(m[0], ' ');
    return true;
  };

  // "por/a la mañana" es un momento del día, no "mañana" (= día siguiente)
  take(/\s(?:por|a|de|en)\s+la\s+ma[ñn]ana\b/i, () => {});
  take(/\s(?:por|a|de)\s+la\s+(?:tarde|noche)\b/i, () => (afternoon = true));

  // Hora: "a las 9", "8:30", "8h", "8 hs", "9am", "5 pm"
  take(/\s(?:a\s+las?\s+)?(\d{1,2}):(\d{2})\s*(hs?|hrs?|am|pm)?(?=\s|[.,;]|$)/i, (m) => {
    time = { h: Number(m[1]), m: Number(m[2]) };
    if (m[3]?.toLowerCase() === 'pm' && time.h < 12) time.h += 12;
  }) ||
    take(/\s(?:a\s+las?\s+)?(\d{1,2})\s*(hs?|hrs?|am|pm)(?=\s|[.,;]|$)/i, (m) => {
      time = { h: Number(m[1]), m: 0 };
      if (m[2]?.toLowerCase() === 'pm' && time.h < 12) time.h += 12;
    }) ||
    take(/\sa\s+las?\s+(\d{1,2})(?=\s|[.,;]|$)/i, (m) => {
      time = { h: Number(m[1]), m: 0 };
    });
  if (time && afternoon && time.h < 12) time.h += 12;
  if (time && (time.h > 23 || time.m > 59)) time = undefined;

  // Día
  take(/\spasado\s+ma[ñn]ana\b/i, () => (day = addDays(now, 2))) ||
    take(/\sma[ñn]ana\b/i, () => (day = addDays(now, 1))) ||
    take(/\shoy\b/i, () => (day = addDays(now, 0))) ||
    take(/\sen\s+(\d{1,3})\s+d[ií]as?\b/i, (m) => (day = addDays(now, Number(m[1])))) ||
    take(/\s(?:el\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s|[.,;]|$)/, (m) => {
      const d = Number(m[1]);
      const mo = Number(m[2]) - 1;
      let y = m[3] ? Number(m[3]) : now.getFullYear();
      if (y < 100) y += 2000;
      let candidate = new Date(y, mo, d);
      // Sin año y ya pasó → el año que viene
      if (!m[3] && candidate < addDays(now, 0)) candidate = new Date(y + 1, mo, d);
      if (candidate.getMonth() === mo && candidate.getDate() === d) day = candidate;
    }) ||
    take(
      /\s(?:el\s+|este\s+|pr[oó]ximo\s+)?(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)(?:\s+(?:que\s+viene|pr[oó]ximo))?\b/i,
      (m) => {
        const target = WEEKDAYS.indexOf(norm(m[1]!));
        let delta = (target - now.getDay() + 7) % 7;
        if (delta === 0) delta = 7; // "el lunes" dicho un lunes = el siguiente
        day = addDays(now, delta);
      }
    );

  // Solo hora → hoy
  if (time && !day) day = addDays(now, 0);

  return { day, time, rest: rest.replace(/\s+/g, ' ').trim() };
}

/** "#urgente" → "🔥 Urgente" si alguna opción empieza (sin emojis ni tildes) con esa palabra. */
function matchOption(tag: string, options: string[]): string | undefined {
  const t = norm(tag);
  if (!t) return undefined;
  return options.find((o) => norm(o) === t) || options.find((o) => norm(o).startsWith(t)) || options.find((o) => norm(o).split(' ').includes(t));
}

/** "#pjc" / "#fundaciones-olimpia" → fila relacionada por palabra clave o comienzo del título. */
function matchTarget(tag: string, relationProps: DbProperty[]): { prop: string; id: string; title: string } | undefined {
  const t = norm(tag);
  if (!t) return undefined;
  for (const p of relationProps) {
    const targets = p.targets || [];
    const hit =
      targets.find((x) => x.keywords.some((k) => norm(k) === t) || norm(x.title) === t) ||
      targets.find((x) => norm(x.title).startsWith(t)) ||
      targets.find((x) => norm(x.title).split(' ').includes(t));
    if (hit) return { prop: p.name, id: hit.id, title: hit.title };
  }
  return undefined;
}

/** Texto a insertar como #etiqueta para una opción o fila: sin emojis ni tildes, con guiones. */
export function tagFor(label: string): string {
  return norm(label).replace(/\s+/g, '-');
}

function hasWords(haystack: string, needle: string): boolean {
  const n = norm(needle);
  return n.length >= 2 && ` ${haystack} `.includes(` ${n} `);
}

function cleanTitle(s: string): string {
  const t = s
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/^[\s,.;:–-]+|[\s,;:–-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : t;
}

const DONE_PROP = /hech|done|complet|listo|termin/i;

export function extractRow(text: string, db: NotionDatabase, now = new Date(), ai?: AiExtraction): ExtractedRow {
  const props: Record<string, unknown> = {};
  const chips: string[] = [];
  const byType = (t: string) => db.properties.filter((p) => p.type === t);

  // 1) Fecha y hora
  const dateProp = byType('date')[0];
  const { day, time, rest } = parseSpanishDate(text, now);
  let remaining = rest;
  if (dateProp && ai?.date) {
    props[dateProp.name] = { date: { start: ai.date } };
    chips.push(`📅 ${ai.date.replace('T', ' ').slice(0, 16)}`);
  } else if (dateProp && day) {
    props[dateProp.name] = { date: { start: toNotionDate(day, time) } };
    chips.push(chipForDate(day, time, now));
  } else {
    remaining = text;
  }

  // 2) #etiquetas: opciones de selects/estado y filas de relaciones (#urgente, #master-estructuras, #pjc)
  const selectable = db.properties.filter((p) => ['select', 'multi_select', 'status'].includes(p.type) && p.options?.length);
  const relationProps = byType('relation');
  const relHits = new Map<string, Map<string, string>>(); // propiedad → id → título
  const addRel = (prop: string, id: string, title: string) => {
    if (!relHits.has(prop)) relHits.set(prop, new Map());
    relHits.get(prop)!.set(id, title);
  };
  const used = new Set<string>();
  remaining = remaining.replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (full, pre: string, tag: string) => {
    for (const p of selectable) {
      if (used.has(p.name) && p.type !== 'multi_select') continue;
      const opt = matchOption(tag, p.options!);
      if (!opt) continue;
      used.add(p.name);
      setOption(props, p, opt);
      chips.push(opt);
      return pre;
    }
    const target = matchTarget(tag, relationProps);
    if (target) {
      addRel(target.prop, target.id, target.title);
      return pre;
    }
    return full;
  });
  for (const [name, value] of Object.entries(ai?.selects || {})) {
    const p = selectable.find((x) => x.name === name);
    const values = (Array.isArray(value) ? value : value ? [value] : []).filter((v) => p?.options?.includes(v));
    if (!p || values.length === 0 || used.has(name)) continue;
    used.add(name);
    for (const v of values) setOption(props, p, v);
    chips.push(...values);
  }

  // 3) Relaciones por título o palabras clave en el texto (el texto no se modifica: "PJC" sigue siendo informativo)
  const n = norm(text);
  for (const p of relationProps) {
    const aiTitles = ai?.relations?.[p.name] || [];
    for (const t of p.targets || []) {
      const named = aiTitles.some((a) => a === t.title || a.startsWith(`${t.title} (`)) || hasWords(n, t.title) || t.keywords.some((k) => hasWords(n, k));
      if (named) addRel(p.name, t.id, t.title);
    }
  }
  for (const [prop, hits] of relHits) {
    const list = [...hits].slice(0, 5);
    props[prop] = { relation: list.map(([id]) => ({ id })) };
    chips.push(...list.map(([, title]) => `↗ ${title}`));
  }

  // 4) Título
  const titleProp = db.properties.find((p) => p.type === 'title');
  const title = cleanTitle(ai?.title || remaining) || cleanTitle(text) || 'Sin título';
  if (titleProp) props[titleProp.name] = { title: [{ type: 'text', text: { content: title.slice(0, 2000) } }] };

  const doneProp = byType('checkbox').find((p) => DONE_PROP.test(p.name))?.name;
  return { title, properties: props, chips, doneProp };
}

function setOption(props: Record<string, unknown>, p: DbProperty, name: string): void {
  if (p.type === 'multi_select') {
    const prev = (props[p.name] as { multi_select: { name: string }[] } | undefined)?.multi_select || [];
    props[p.name] = { multi_select: [...prev, { name }] };
  } else {
    props[p.name] = { [p.type]: { name } };
  }
}

/** Esquema compacto para que la IA sepa qué puede completar. */
export function schemaForAi(db: NotionDatabase) {
  return db.properties
    .filter((p) => ['title', 'date', 'select', 'multi_select', 'status', 'relation'].includes(p.type))
    .map((p) => ({
      name: p.name,
      type: p.type,
      ...(p.options ? { options: p.options } : {}),
      ...(p.targets ? { options: p.targets.map((t) => (t.keywords.length ? `${t.title} (${t.keywords.join(', ')})` : t.title)) } : {})
    }));
}
