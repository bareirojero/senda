import { beforeEach, describe, expect, it, vi } from 'vitest';

// Notion en memoria: una base con filas
const fake = vi.hoisted(() => {
  const state = { databases: [] as any[], rows: [] as any[], created: [] as any[] };
  const text = (s: string) => [{ plain_text: s, text: { content: s } }];
  const toProps = (p: any) => ({
    Mensaje: { title: text((p.Mensaje?.title || []).map((t: any) => t.text.content).join('')) },
    'ID Senda': { number: p['ID Senda'].number },
    Datos: { rich_text: text((p.Datos?.rich_text || []).map((t: any) => t.text.content).join('')) }
  });
  class Client {
    search = vi.fn(async ({ filter }: any) => ({
      results: filter.value === 'database' ? state.databases : [{ id: 'page-1', parent: { type: 'workspace' } }]
    }));
    databases = {
      create: vi.fn(async (args: any) => {
        const db = { id: 'inbox-db', title: [{ plain_text: args.title[0].text.content }] };
        state.databases.push(db);
        state.created.push(args);
        return db;
      }),
      query: vi.fn(async ({ filter }: any) => ({
        results: state.rows.filter((r) => !r.archived && (!filter || r.properties['ID Senda'].number === filter.number.equals)),
        has_more: false
      }))
    };
    pages = {
      create: vi.fn(async ({ properties }: any) => {
        const row = { id: `row-${state.rows.length + 1}`, properties: toProps(properties), archived: false };
        state.rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ page_id, properties, archived }: any) => {
        const row = state.rows.find((r) => r.id === page_id);
        if (!row) throw new Error('not found');
        if (properties) row.properties = toProps(properties);
        if (archived) row.archived = true;
        return row;
      })
    };
  }
  return { state, Client };
});
vi.mock('@notionhq/client', () => ({ Client: fake.Client }));

const { default: handler } = await import('../api/inbox');

function call(method: string, { body, query = {}, headers = {} }: { body?: unknown; query?: Record<string, string>; headers?: Record<string, string> } = {}) {
  const res: any = { statusCode: 200, body: undefined, status(c: number) { res.statusCode = c; return res; }, json(b: unknown) { res.body = b; return res; } };
  return (handler({ method, body, query, headers, cookies: {} } as any, res) as Promise<unknown>).then(() => res);
}

beforeEach(() => {
  process.env.NOTION_TOKEN = `ntn_${Math.random()}`; // token nuevo = sin caché de la base
  delete process.env.SENDA_ACCESS_KEY;
  delete process.env.NOTION_DEFAULT_PAGE_ID;
  fake.state.databases.length = 0;
  fake.state.rows.length = 0;
  fake.state.created.length = 0;
});

describe('/api/inbox', () => {
  it('sin bandeja todavía: GET devuelve vacío y no crea nada', async () => {
    const res = await call('GET');
    expect(res.body).toEqual({ notes: [], settings: {}, databaseId: null });
    expect(fake.state.created).toHaveLength(0);
  });

  it('el primer guardado crea la base dentro de la página destino y la fila', async () => {
    const note = { id: 1795030000000, text: 'Recibir H-30', blockType: 'todo', status: 'sent', dest: 'Mis tareas', chips: ['🔥 Urgente'] };
    const res = await call('POST', { body: { note }, headers: { 'x-notion-page-id': 'pagina-destino' } });
    expect(res.statusCode).toBe(200);
    expect(fake.state.created[0].parent).toEqual({ type: 'page_id', page_id: 'pagina-destino' });
    expect(fake.state.created[0].title[0].text.content).toBe('Senda · Bandeja');

    const list = await call('GET');
    expect(list.body.notes).toEqual([{ ...note, inboxId: res.body.inboxId }]);
  });

  it('actualiza la misma fila en vez de duplicar, y DELETE la archiva', async () => {
    await call('POST', { body: { note: { id: 5, text: 'a' } } });
    await call('POST', { body: { note: { id: 5, text: 'a editada', done: true } } });
    expect(fake.state.rows.filter((r) => !r.archived)).toHaveLength(1);
    expect((await call('GET')).body.notes[0]).toMatchObject({ id: 5, text: 'a editada', done: true });

    await call('DELETE', { query: { id: '5' } });
    expect((await call('GET')).body.notes).toEqual([]);
  });

  it('guarda y devuelve los ajustes compartidos', async () => {
    await call('PUT', { body: { settings: { senda_tasks_db: 'db-1' } } });
    const res = await call('GET');
    expect(res.body.settings).toEqual({ senda_tasks_db: 'db-1' });
    expect(res.body.notes).toEqual([]);
  });

  it('con SENDA_ACCESS_KEY exige la clave', async () => {
    process.env.SENDA_ACCESS_KEY = 'clave-secreta-123';
    expect((await call('GET')).statusCode).toBe(401);
    expect((await call('GET', { headers: { 'x-senda-key': 'clave-secreta-123' } })).statusCode).toBe(200);
  });
});
