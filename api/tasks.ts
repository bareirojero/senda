import { Client } from '@notionhq/client';
import { errorMessage, queryParam, type ApiRequest, type ApiResponse } from './_lib/http.js';
import { requireAccess, resolveAuth } from './_lib/auth.js';

/**
 * GET /api/tasks?db=<id>
 * Tareas pendientes de una base (casilla "Hecho" sin marcar), ordenadas por fecha.
 * Las usa la vista "Hoy" y el chat (para que Gemini responda con datos reales).
 */

const DB_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const DONE_PROP = /hech|done|complet|listo|termin/i;

export interface TaskRow {
  id: string;
  url: string;
  title: string;
  date: string | null;
  selects: Record<string, string[]>;
  relations: Record<string, string[]>;
}

function plain(rich: any[] = []): string {
  return rich.map((t: any) => t.plain_text).join('').trim();
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });
  if (!requireAccess(req, res)) return;
  const auth = resolveAuth(req);
  if (!auth) return res.status(401).json({ error: 'Notion no está conectado' });

  const dbId = queryParam(req, 'db');
  if (!DB_ID.test(dbId)) return res.status(400).json({ error: 'db inválida.' });

  const notion = new Client({ auth: auth.token });
  try {
    const db: any = await notion.databases.retrieve({ database_id: dbId });
    const props = Object.entries(db.properties || {}) as [string, any][];
    const doneProp = props.find(([n, p]) => p.type === 'checkbox' && DONE_PROP.test(n))?.[0];
    const statusProp = props.find(([, p]) => p.type === 'status')?.[0];
    const dateProp = props.find(([, p]) => p.type === 'date')?.[0];

    const filter = doneProp
      ? { property: doneProp, checkbox: { equals: false } }
      : statusProp
        ? { property: statusProp, status: { does_not_equal: 'Done' } }
        : undefined;

    const tasks: TaskRow[] = [];
    let cursor: string | undefined;
    do {
      const r: any = await notion.databases.query({
        database_id: dbId,
        ...(filter ? { filter: filter as any } : {}),
        ...(dateProp ? { sorts: [{ property: dateProp, direction: 'ascending' }] } : {}),
        page_size: 100,
        start_cursor: cursor
      });
      for (const page of r.results) {
        const row: TaskRow = { id: page.id, url: page.url, title: '', date: null, selects: {}, relations: {} };
        for (const [name, p] of Object.entries(page.properties || {}) as [string, any][]) {
          if (p.type === 'title') row.title = plain(p.title);
          else if (p.type === 'date' && name === dateProp) row.date = p.date?.start || null;
          else if (p.type === 'select' && p.select) row.selects[name] = [p.select.name];
          else if (p.type === 'status' && p.status) row.selects[name] = [p.status.name];
          else if (p.type === 'multi_select' && p.multi_select?.length) row.selects[name] = p.multi_select.map((o: any) => o.name);
          else if (p.type === 'relation' && p.relation?.length) row.relations[name] = p.relation.map((x: any) => x.id);
        }
        if (row.title) tasks.push(row);
      }
      cursor = r.has_more && tasks.length < 300 ? r.next_cursor : undefined;
    } while (cursor);

    return res.status(200).json({ tasks, doneProp: doneProp || null, dateProp: dateProp || null });
  } catch (err) {
    return res.status(500).json({ error: errorMessage(err) });
  }
}
