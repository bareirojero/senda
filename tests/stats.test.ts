import { describe, expect, it } from 'vitest';
import { computeStats, niceScale, splitByDay, UNASSIGNED } from '../src/ui/stats';

const H = 3_600_000;
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();

describe('splitByDay', () => {
  it('parte un tramo que cruza la medianoche', () => {
    const parts = splitByDay({ i: 'a', a: at(18, 23), b: at(19, 1, 30) });
    expect(parts).toEqual([
      ['2026-11-18', H],
      ['2026-11-19', 1.5 * H]
    ]);
  });
});

describe('niceScale', () => {
  it('redondea a pasos legibles', () => {
    expect(niceScale(7.3)).toEqual({ max: 8, step: 2 });
    expect(niceScale(0)).toEqual({ max: 1, step: 1 });
  });
});

describe('computeStats', () => {
  const now = at(19, 18);
  const history = {
    log: [
      { i: 'a', a: at(19, 9), b: at(19, 11) },
      { i: 'b', a: at(18, 14), b: at(18, 15) },
      { i: 'c', a: at(19, 12), b: at(19, 12, 30) },
      { i: 'old', a: at(1, 9), b: at(1, 10) }
    ],
    done: [
      { i: 'a', d: at(19, 11), g: { Ámbito: ['Trabajo'] } },
      { i: 'x', d: at(17, 10), g: { Ámbito: ['Personal'] } }
    ],
    time: {
      a: { t: 2 * H, u: now, n: 'Memoria de cálculo', g: { Ámbito: ['Trabajo'] } },
      b: { t: H, u: now, n: 'Turno médico', g: { Ámbito: ['Personal'] } },
      c: { t: 0.5 * H, u: now, n: 'Sin ámbito' }
    }
  };

  it('suma horas por día y por grupo, en el orden de Notion', () => {
    const s = computeStats(history, 'Ámbito', ['Personal', 'Trabajo'], 7, now);
    expect(s.days).toHaveLength(7);
    const today = s.days[6]!;
    expect(today.ms.get('Trabajo')).toBe(2 * H);
    expect(today.ms.get(UNASSIGNED)).toBe(0.5 * H);
    expect(s.days[5]!.ms.get('Personal')).toBe(H);
    expect(s.groups).toEqual(['Personal', 'Trabajo', UNASSIGNED]);
    expect(s.todayMs).toBe(2.5 * H);
  });

  it('cuenta completadas por día y en la semana (lunes a domingo)', () => {
    const s = computeStats(history, 'Ámbito', ['Personal', 'Trabajo'], 7, now);
    expect(s.days[6]!.done.get('Trabajo')).toBe(1);
    expect(s.days[4]!.done.get('Personal')).toBe(1);
    // 19/11/2026 es jueves: la semana arranca el lunes 16
    expect(s.weekDone).toBe(2);
    expect(s.weekMs).toBe(3.5 * H);
  });

  it('ordena las tareas con más tiempo y deja afuera lo viejo', () => {
    const s = computeStats(history, 'Ámbito', [], 7, now);
    expect(s.top.map((t) => t.title)).toEqual(['Memoria de cálculo', 'Turno médico', 'Sin ámbito']);
  });

  it('pliega en "Otros" pasados los 7 grupos', () => {
    const log = Array.from({ length: 9 }, (_, k) => ({ i: `t${k}`, a: at(19, 8), b: at(19, 9) }));
    const time = Object.fromEntries(log.map((l, k) => [l.i, { t: H, u: now, g: { Cat: [`C${k}`] } }]));
    const s = computeStats({ log, done: [], time }, 'Cat', [], 7, now);
    expect(s.groups).toHaveLength(7);
    expect(s.groups.at(-1)).toBe('Otros');
    expect(s.days[6]!.ms.get('Otros')).toBe(3 * H);
  });
});
