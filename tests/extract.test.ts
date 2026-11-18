import { describe, expect, it } from 'vitest';
import { extractRow, parseSpanishDate, toNotionDate } from '../src/lib/extract';
import type { NotionDatabase } from '../src/types';

// Miércoles 18/11/2026, 10:00 hora local
const NOW = new Date(2026, 10, 18, 10, 0);

/** Réplica del esquema real de "Mis tareas" + "🏗️ Obras". */
const misTareas: NotionDatabase = {
  id: 'a0fa72e5-afea-4df3-90e8-3b4d970462ec',
  title: 'Mis tareas',
  properties: [
    { name: 'Tarea', type: 'title' },
    { name: 'Fecha', type: 'date' },
    { name: 'Hecho', type: 'checkbox' },
    { name: 'Obra consultada', type: 'checkbox' },
    { name: 'Categoría', type: 'select', options: ['🔥 Urgente', '🤔 Considerar', '🇷🇺 Ruso', '🏗️ Máster Estructuras', '🧱 BIG', '📌 Otros'] },
    { name: 'Ámbito', type: 'select', options: ['Trabajo', 'Personal'] },
    { name: 'Cuándo', type: 'formula' },
    {
      name: 'Obra',
      type: 'relation',
      targets: [
        { id: 'obra-pjc', title: 'Edificio PJC', keywords: ['PJC', 'Pedro Juan'] },
        { id: 'obra-olimpia', title: 'Fundaciones OLIMPIA', keywords: ['Olimpia'] }
      ]
    }
  ]
};

const day = (d: number, m = 11) => `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

describe('parseSpanishDate', () => {
  it.each([
    ['revisar planos hoy', day(18)],
    ['mañana revisar planos', day(19)],
    ['pasado mañana revisar', day(20)],
    ['el viernes entregar', day(20)],
    ['el miércoles entregar', day(25)],
    ['lunes que viene reunión', day(23)],
    ['entregar el 3/12', day(3, 12)],
    ['en 10 días vence', day(28)]
  ])('%s → %s', (text, expected) => {
    const { day: d } = parseSpanishDate(text, NOW);
    expect(d && toNotionDate(d)).toBe(expected);
  });

  it('el 1/3 sin año ya pasado es del año siguiente', () => {
    const { day: d } = parseSpanishDate('pagar el 1/3', NOW);
    expect(d && toNotionDate(d)).toBe('2027-03-01');
  });

  it('detecta horas y "de la tarde"', () => {
    expect(parseSpanishDate('mañana 8h', NOW).time).toEqual({ h: 8, m: 0 });
    expect(parseSpanishDate('mañana a las 9:30', NOW).time).toEqual({ h: 9, m: 30 });
    expect(parseSpanishDate('mañana a las 5 de la tarde', NOW).time).toEqual({ h: 17, m: 0 });
    expect(parseSpanishDate('llamar 3pm', NOW).time).toEqual({ h: 15, m: 0 });
  });

  it('"por la mañana" no es "mañana"', () => {
    const r = parseSpanishDate('llamar al proveedor por la mañana', NOW);
    expect(r.day).toBeUndefined();
  });

  it('no confunde H-30 ni cantidades con horas', () => {
    const r = parseSpanishDate('mañana recibir 30 m3 de H-30', NOW);
    expect(r.time).toBeUndefined();
    expect(r.rest).toBe('recibir 30 m3 de H-30');
  });
});

describe('extractRow con el esquema de Mis tareas', () => {
  it('completa título, fecha+hora, categoría y obra', () => {
    const r = extractRow('mañana 8h recibir H-30 en PJC #urgente', misTareas, NOW);
    expect(r.title).toBe('Recibir H-30 en PJC');
    expect(r.properties).toMatchObject({
      Tarea: { title: [{ text: { content: 'Recibir H-30 en PJC' } }] },
      Fecha: { date: { start: expect.stringMatching(/^2026-11-19T08:00:00[+-]\d\d:\d\d$/) } },
      'Categoría': { select: { name: '🔥 Urgente' } },
      Obra: { relation: [{ id: 'obra-pjc' }] }
    });
    expect(r.doneProp).toBe('Hecho');
    expect(r.chips).toEqual(['📅 mañana 08:00', '🔥 Urgente', '↗ Edificio PJC']);
  });

  it('#etiquetas parciales y sin tildes: #master, #personal', () => {
    const r = extractRow('estudiar losas #master #personal', misTareas, NOW);
    expect(r.properties['Categoría']).toEqual({ select: { name: '🏗️ Máster Estructuras' } });
    expect(r.properties['Ámbito']).toEqual({ select: { name: 'Personal' } });
    expect(r.title).toBe('Estudiar losas');
  });

  it('deja en el título las # que no son opciones', () => {
    const r = extractRow('revisar #losa nervada', misTareas, NOW);
    expect(r.title).toBe('Revisar #losa nervada');
  });

  it('enlaza la obra por palabra clave, sin coincidencias parciales', () => {
    expect(extractRow('hormigonar zapatas olimpia', misTareas, NOW).properties.Obra).toEqual({ relation: [{ id: 'obra-olimpia' }] });
    expect(extractRow('comprar pjcx', misTareas, NOW).properties.Obra).toBeUndefined();
  });

  it('sin fecha no inventa una', () => {
    const r = extractRow('pensar idea de tesis', misTareas, NOW);
    expect(r.properties.Fecha).toBeUndefined();
    expect(r.title).toBe('Pensar idea de tesis');
  });

  it('la IA puede completar, pero solo con opciones válidas', () => {
    const r = extractRow('algo para el máster', misTareas, NOW, {
      title: 'Leer capítulo 3',
      selects: { 'Categoría': '🏗️ Máster Estructuras', 'Ámbito': 'Inventado' },
      relations: { Obra: ['Fundaciones OLIMPIA'] }
    });
    expect(r.title).toBe('Leer capítulo 3');
    expect(r.properties['Categoría']).toEqual({ select: { name: '🏗️ Máster Estructuras' } });
    expect(r.properties['Ámbito']).toBeUndefined();
    expect(r.properties.Obra).toEqual({ relation: [{ id: 'obra-olimpia' }] });
  });
});
