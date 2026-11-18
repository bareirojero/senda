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
