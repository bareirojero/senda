// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../src/types';

const note = (id: number, text: string, extra: Partial<Note> = {}): Note => ({ id, time: 'x', topic: 'general', text, ...extra });

function mockServer(initial: (Note & { inboxId?: string })[]) {
  const rows = new Map(initial.map((n) => [n.id, { ...n, inboxId: n.inboxId || `row-${n.id}` }]));
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    calls.push(`${method} ${url}`);
    if (method === 'GET') return new Response(JSON.stringify({ notes: [...rows.values()], settings: { senda_tasks_db: 'db-1' } }));
    if (method === 'POST') {
      const { note: n } = JSON.parse(String(init.body));
      rows.set(n.id, { ...n, inboxId: n.inboxId || `row-${n.id}` });
      return new Response(JSON.stringify({ inboxId: rows.get(n.id)!.inboxId }));
    }
    if (method === 'DELETE') {
      rows.delete(Number(new URL(url, 'http://x').searchParams.get('id')));
      return new Response('{"ok":true}');
    }
    return new Response('{}');
  });
  vi.stubGlobal('fetch', fetchMock);
  return { rows, calls };
}

let sync: typeof import('../src/lib/sync');

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  sync = await import('../src/lib/sync');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function flush() {
  await vi.advanceTimersByTimeAsync(1000);
}

describe('sincronización con "Senda · Bandeja"', () => {
  it('trae notas de otro dispositivo y sube las que solo están aquí', async () => {
    const server = mockServer([note(2000000000002, 'desde el celular')]);
    const result = await sync.pull([note(2000000000001, 'desde la PC')]);
    expect(result!.notes.map((n) => n.text)).toEqual(['desde el celular', 'desde la PC']);
    expect(result!.settings).toEqual({ senda_tasks_db: 'db-1' });

    sync.schedulePush(() => result!.notes);
    await flush();
    expect(server.rows.has(2000000000001)).toBe(true);
    expect(server.calls.filter((c) => c.startsWith('POST'))).toHaveLength(1); // la del celular no se reenvía
  });

  it('borrar aquí la elimina en Notion y no reaparece al volver a sincronizar', async () => {
    const server = mockServer([note(1, 'a'), note(2, 'b')]);
    const first = await sync.pull([]);
    const remaining = first!.notes.filter((n) => n.id !== 1);
    sync.schedulePush(() => remaining);
    await flush();
    expect(server.rows.has(1)).toBe(false);
    const second = await sync.pull(remaining);
    expect(second!.notes.map((n) => n.id)).toEqual([2]);
  });

  it('si otro dispositivo la borró, desaparece aquí', async () => {
    const server = mockServer([note(1, 'a'), note(2, 'b')]);
    const first = await sync.pull([]);
    server.rows.delete(1); // borrada desde el celular
    const second = await sync.pull(first!.notes);
    expect(second!.notes.map((n) => n.id)).toEqual([2]);
  });

  it('un cambio local aún sin subir gana sobre la versión del servidor', async () => {
    mockServer([note(1, 'tarea', { done: false })]);
    const first = await sync.pull([]);
    const edited = first!.notes.map((n) => ({ ...n, done: true }));
    const second = await sync.pull(edited);
    expect(second!.notes[0]!.done).toBe(true);
  });

  it('falta de clave de acceso se informa sin romper nada', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'access_key' }), { status: 401 })));
    const states: string[] = [];
    sync.onSyncState((s) => states.push(s));
    expect(await sync.pull([note(1, 'x')])).toBeNull();
    expect(states).toContain('access_key');
  });
});

describe('ajustes compartidos', () => {
  it('lo que guardaste aquí y aún no se subió no lo pisa la versión vieja de Notion', async () => {
    localStorage.setItem('senda_today_group_prop', 'Ámbito');
    sync.markSettingsDirty();
    expect(sync.applySettings({ senda_today_group_prop: '__none__' })).toBe(false);
    expect(localStorage.getItem('senda_today_group_prop')).toBe('Ámbito');
  });

  it('después de subir, vuelve a aceptar lo que llega de otros dispositivos', async () => {
    mockServer([]);
    await sync.pull([]); // habilita la sincronización
    localStorage.setItem('senda_today_group_prop', 'Ámbito');
    sync.markSettingsDirty();
    expect(await sync.pushSettings()).toBe(true);
    expect(sync.applySettings({ senda_today_group_prop: 'Categoría' })).toBe(true);
    expect(localStorage.getItem('senda_today_group_prop')).toBe('Categoría');
  });
});
