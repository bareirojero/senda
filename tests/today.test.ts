// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { TodayPanel, localDay } from '../src/ui/today';
import type { TaskRow } from '../src/types';

const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return localDay(d); };
const task = (id: string, title: string, date: string | null, ambito: string): TaskRow => ({ id, url: '#', title, date, selects: { 'Ámbito': [ambito] }, relations: {} });

function panel() {
  const el = document.createElement('div');
  const store = new Map<string, string>();
  const toggled: string[] = [];
  const p = new TodayPanel(el, (t) => toggled.push(t.id), { get: (k) => store.get(k) || '', set: (k, v) => store.set(k, v) });
  p.setData(
    [
      task('1', 'Vencida de trabajo', day(-1), 'Trabajo'),
      task('2', 'Hoy de trabajo', day(0), 'Trabajo'),
      task('3', 'Hoy personal', `${day(0)}T19:30:00`, 'Personal'),
      task('4', 'Mañana', day(1), 'Trabajo'),
      task('5', 'Sin fecha', null, 'Personal')
    ],
    { groupProp: 'Ámbito', groupOptions: ['Trabajo', 'Personal'], relTitles: new Map() }
  );
  return { el, toggled };
}

const titles = (el: HTMLElement) => [...el.querySelectorAll('.today-title')].map((a) => a.textContent);

describe('vista Hoy', () => {
  it('a la vista solo las de hoy; Vencidas y A futuro plegadas, con su cantidad', () => {
    const { el } = panel();
    expect(titles(el)).toEqual(['Hoy de trabajo', 'Hoy personal']);
    const sections = [...el.querySelectorAll<HTMLButtonElement>('[data-today-section]')];
    expect(sections.map((b) => b.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['Vencidas · 1', 'A futuro · 1']);
    expect(el.querySelector('.today-count')?.textContent).toBe('2');
  });

  it('desplegar Vencidas y A futuro (y las tareas sin fecha no aparecen)', () => {
    const { el } = panel();
    el.querySelector<HTMLButtonElement>('[data-today-section="overdue"]')!.click();
    el.querySelector<HTMLButtonElement>('[data-today-section="future"]')!.click();
    expect(titles(el)).toEqual(['Vencida de trabajo', 'Hoy de trabajo', 'Hoy personal', 'Mañana']);
  });

  it('dos botones Trabajo / Personal con su cantidad, y filtran', () => {
    const { el } = panel();
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('.today-group')];
    expect(buttons.map((b) => b.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['Trabajo 3', 'Personal 1']);
    buttons[1]!.click();
    expect(titles(el)).toEqual(['Hoy personal']);
    el.querySelector<HTMLButtonElement>('[data-today-group="Personal"]')!.click(); // otro toque: todas
    expect(titles(el)).toHaveLength(2);
  });

  it('marcar una tarea avisa para actualizar Notion', () => {
    const { el, toggled } = panel();
    el.querySelector<HTMLButtonElement>('[data-today-task="2"]')!.click();
    expect(toggled).toEqual(['2']);
  });
});

import { applyOrder, mergeOrder } from '../src/ui/today';

describe('orden manual', () => {
  const t = (id: string, date: string | null) => task(id, id, date, 'Trabajo');
  it('primero lo ordenado a mano, después el resto por fecha', () => {
    const list = [t('a', '2026-11-20'), t('b', '2026-11-18'), t('c', '2026-11-19'), t('d', null)];
    expect(applyOrder(list, ['c', 'a']).map((x) => x.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('reordenar una sección no desordena las otras', () => {
    expect(mergeOrder(['x', 'a', 'y', 'b'], ['b', 'a'])).toEqual(['b', 'a', 'x', 'y']);
  });
});

describe('En curso', () => {
  it('▶ la sube a "En curso" (siempre visible) y avisa para guardar', () => {
    const el = document.createElement('div');
    const saved: { doing: string[] }[] = [];
    const p = new TodayPanel(el, () => {}, { get: () => '', set: () => {} }, (prefs) => saved.push(prefs));
    p.setData([task('1', 'Vencida', day(-1), 'Trabajo'), task('2', 'De hoy', day(0), 'Trabajo')], { groupProp: 'Ámbito', groupOptions: [], relTitles: new Map() });
    el.querySelector<HTMLButtonElement>('[data-today-section="overdue"]')!.click(); // desplegar Vencidas
    el.querySelector<HTMLButtonElement>('[data-today-doing="1"]')!.click();
    el.querySelector<HTMLButtonElement>('[data-today-section="overdue"]')?.click(); // ya no hay vencidas sueltas
    expect(el.querySelector('.today-label.doing')?.textContent).toContain('En curso · 1');
    expect(titles(el)).toEqual(['Vencida', 'De hoy']); // visible aunque Vencidas esté plegada
    expect(saved.at(-1)!.doing).toEqual(['1']);
    el.querySelector<HTMLButtonElement>('[data-today-doing="1"]')!.click();
    expect(saved.at(-1)!.doing).toEqual([]);
  });

  it('al marcarla hecha sale de "En curso"', () => {
    const el = document.createElement('div');
    const saved: { doing: string[] }[] = [];
    const p = new TodayPanel(el, () => {}, { get: () => '', set: () => {} }, (prefs) => saved.push(prefs));
    p.setPrefs({ order: [], doing: ['2'], time: {} });
    p.setData([task('2', 'De hoy', day(0), 'Trabajo')], { groupProp: 'Ámbito', groupOptions: [], relTitles: new Map() });
    p.settle('2', true);
    expect(saved.at(-1)!.doing).toEqual([]);
  });

  it('al completarla queda registrada con su ámbito, para Rendimiento', () => {
    const el = document.createElement('div');
    const p = new TodayPanel(el, () => {}, { get: () => '', set: () => {} }, () => {});
    p.setData([task('7', 'Planilla', day(0), 'Personal')], { groupProp: 'Ámbito', groupOptions: [], relTitles: new Map() });
    p.settle('7', true);
    expect(p.history().done.at(-1)).toMatchObject({ i: '7', g: { 'Ámbito': ['Personal'] } });
  });
});

import { elapsed, formatDuration, toggleTimer } from '../src/ui/today';

describe('tiempo en curso', () => {
  const H = 3600000;
  it('suma los tramos: poner, sacar y volver a poner En curso', () => {
    let time = toggleTimer({}, 'a', true, 0); // ▶ 0:00
    time = toggleTimer(time, 'a', false, 30 * 60000); // ⏸ a los 30 min
    time = toggleTimer(time, 'a', true, H); // ▶ otra vez a la hora
    expect(elapsed(time.a, H + 15 * 60000)).toBe(45 * 60000); // corriendo: 30 + 15
    time = toggleTimer(time, 'a', false, 2 * H); // ⏸
    expect(elapsed(time.a, 5 * H)).toBe(90 * 60000); // pausado: no sigue sumando
  });

  it('formato legible', () => {
    expect(formatDuration(42 * 60000)).toBe('42 min');
    expect(formatDuration(65 * 60000)).toBe('1 h 05');
    expect(formatDuration(12.5 * H)).toBe('12 h 30');
  });

  it('el panel muestra el reloj, avisa al pausar y al terminar con el total', () => {
    const el = document.createElement('div');
    const stops: [string, number][] = [];
    const p = new TodayPanel(el, () => {}, { get: () => '', set: () => {} }, () => {}, (id, ms) => stops.push([id, ms]));
    p.setPrefs({ order: [], doing: [], time: { '2': { t: 65 * 60000, u: Date.now() } } });
    p.setData([task('2', 'De hoy', day(0), 'Trabajo')], { groupProp: 'Ámbito', groupOptions: [], relTitles: new Map() });
    expect(el.querySelector('[data-timer="2"]')?.textContent).toBe('⏱ 1 h 05');
    el.querySelector<HTMLButtonElement>('[data-today-doing="2"]')!.click(); // ▶
    expect(el.querySelector('[data-timer="2"]')?.classList.contains('running')).toBe(true);
    el.querySelector<HTMLButtonElement>('[data-today-doing="2"]')!.click(); // ⏸
    expect(stops).toHaveLength(1);
    expect(stops[0]![1]).toBeGreaterThanOrEqual(65 * 60000);
    el.querySelector<HTMLButtonElement>('[data-today-doing="2"]')!.click(); // ▶
    p.settle('2', true); // hecha
    expect(stops).toHaveLength(2);
  });
});

import { parseDuration, setTotal } from '../src/ui/today';

describe('corregir el tiempo', () => {
  const H = 3600000;
  it('entiende varias formas de escribir una duración', () => {
    expect(parseDuration('2:30')).toBe(2.5 * H);
    expect(parseDuration('2 h 30')).toBe(2.5 * H);
    expect(parseDuration('2,5')).toBe(2.5 * H);
    expect(parseDuration('3 h')).toBe(3 * H);
    expect(parseDuration('45 min')).toBe(45 * 60000);
    expect(parseDuration('hola')).toBeNull();
  });

  it('bajar el total recorta los tramos más recientes del historial', () => {
    const prefs = {
      order: [], doing: [], time: { a: { t: 5 * H, u: 0 } },
      log: [
        { i: 'a', a: 0, b: 2 * H },
        { i: 'b', a: 0, b: H },
        { i: 'a', a: 10 * H, b: 13 * H }
      ]
    };
    const next = setTotal(prefs, 'a', 3 * H, 20 * H);
    expect(next.time.a!.t).toBe(3 * H);
    expect(next.log).toEqual([
      { i: 'a', a: 0, b: 2 * H },
      { i: 'b', a: 0, b: H },
      { i: 'a', a: 10 * H, b: 11 * H }
    ]);
  });

  it('se olvidó de pausar: "Pausar ahí" cierra el tramo a esa hora', () => {
    const el = document.createElement('div');
    const saved: { doing: string[]; log?: { a: number; b: number }[] }[] = [];
    const stops: number[] = [];
    const p = new TodayPanel(el, () => {}, { get: () => '', set: () => {} }, (prefs) => saved.push(prefs), (_, ms) => stops.push(ms));
    const start = Date.now() - 72 * H;
    p.setPrefs({ order: [], doing: ['2'], time: { '2': { t: 0, s: start, u: start } } });
    p.setData([task('2', 'Resumen de lluvias', day(0), 'Trabajo')], { groupProp: 'Ámbito', groupOptions: [], relTitles: new Map() });
    el.querySelector<HTMLElement>('[data-timer="2"]')!.click();
    const input = el.querySelector<HTMLInputElement>('[name=stop-at]')!;
    const at = new Date(start + 2 * H);
    const pad = (n: number) => String(n).padStart(2, '0');
    input.value = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
    el.querySelector<HTMLElement>('[data-time-action=stop-at]')!.click();
    const last = saved.at(-1)!;
    expect(last.doing).toEqual([]);
    expect(Math.abs(stops.at(-1)! - 2 * H)).toBeLessThan(60000);
    expect(el.querySelector('.today-time-edit')).toBeNull();
  });
});
