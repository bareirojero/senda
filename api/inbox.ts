import { Client } from '@notionhq/client';
import { errorMessage, header, queryParam, type ApiRequest, type ApiResponse } from './_lib/http.js';
import { requireAccess, resolveAuth } from './_lib/auth.js';

/**
 * Historial y ajustes de Senda guardados en Notion, para verlos igual en todos los dispositivos.
 *
 * Base "Senda · Bandeja" (se crea sola dentro de la página destino):
 *   Mensaje (título) · Tipo · Destino · Estado · ID Senda (número) · Datos (JSON de la nota)
 * La fila con ID Senda = 0 guarda los ajustes.
 *
 *   GET    /api/inbox            → { notes, settings, databaseId }
 *   POST   /api/inbox            → { note } crea o actualiza (por ID Senda) → { inboxId }
 *   PUT    /api/inbox            → { settings } guarda ajustes
 *   DELETE /api/inbox?id=123     → manda la fila a la papelera
 */

export const INBOX_TITLE = 'Senda · Bandeja';
const SETTINGS_ID = 0;
const CHUNK = 2000;

const TYPE_OPTIONS = ['Nota', 'Tarea', 'Pregunta', 'Respuesta', 'Ajustes'];
const STATUS_OPTIONS = ['Enviado', 'Error', 'Solo en Senda'];

interface SyncedNote {
  id: number;
  text: string;
  isAI?: boolean;
  kind?: string;
  blockType?: string;
  status?: string;
  dest?: string;
  inboxId?: string;
  [k: string]: unknown;
}

// Caché por instancia "tibia" de la función: evita buscar la base en cada llamada
const dbCache = new Map<string, string>();

function richText(s: string) {
  const out = [];
  for (let i = 0; i < s.length && out.length < 100; i += CHUNK) out.push({ type: 'text', text: { content: s.slice(i, i + CHUNK) } });
  return out;
}

function readRich(prop: any): string {
  return (prop?.rich_text || prop?.title || []).map((t: any) => t.plain_text ?? t.text?.content ?? '').join('');
}

function typeOf(n: SyncedNote): string {
  if (n.isAI) return 'Respuesta';
  if (n.kind === 'question') return 'Pregunta';
  if (n.blockType === 'todo') return 'Tarea';
  return 'Nota';
}

function statusOf(n: SyncedNote): string | null {
  if (n.status === 'sent') return 'Enviado';
  if (n.status === 'error') return 'Error';
  if (n.status === 'local') return 'Solo en Senda';
  return null;
}

async function findInbox(notion: Client, token: string): Promise<string | null> {
  if (process.env.SENDA_INBOX_DB_ID) return process.env.SENDA_INBOX_DB_ID;
  if (dbCache.has(token)) return dbCache.get(token)!;
  const r: any = await notion.search({ query: INBOX_TITLE, filter: { property: 'object', value: 'database' } as any, page_size: 10 });
  const db = r.results.find((d: any) => (d.title || []).map((t: any) => t.plain_text).join('').trim() === INBOX_TITLE && !d.archived);
  if (db) dbCache.set(token, db.id);
  return db?.id || null;
}

async function createInbox(notion: Client, token: string, parentPageId: string): Promise<string> {
  const db: any = await notion.databases.create({
    parent: { type: 'page_id', page_id: parentPageId },
    icon: { type: 'emoji', emoji: '📥' },
    title: [{ type: 'text', text: { content: INBOX_TITLE } }],
    properties: {
      Mensaje: { title: {} },
      Tipo: { select: { options: TYPE_OPTIONS.map((name) => ({ name })) } },
      Destino: { rich_text: {} },
      Estado: { select: { options: STATUS_OPTIONS.map((name) => ({ name })) } },
      'ID Senda': { number: {} },
      Datos: { rich_text: {} }
    }
  } as any);
  dbCache.set(token, db.id);
  return db.id;
}

/** Página donde crear la bandeja: la destino elegida, la del servidor o la primera compartida. */
async function parentPage(notion: Client, req: ApiRequest): Promise<string | null> {
  const fromClient = header(req, 'x-notion-page-id');
  if (fromClient) return fromClient;
  if (process.env.NOTION_DEFAULT_PAGE_ID) return process.env.NOTION_DEFAULT_PAGE_ID;
  const r: any = await notion.search({ filter: { property: 'object', value: 'page' } as any, page_size: 20 });
  return r.results.find((p: any) => p.parent?.type !== 'database_id')?.id || null;
}

async function rowFor(notion: Client, dbId: string, sendaId: number): Promise<string | null> {
  const r: any = await notion.databases.query({ database_id: dbId, filter: { property: 'ID Senda', number: { equals: sendaId } }, page_size: 1 });
  return r.results[0]?.id || null;
}

function propsFor(note: SyncedNote) {
  const { inboxId: _omit, ...data } = note;
  const status = statusOf(note);
  return {
    Mensaje: { title: richText((note.text || '(vacío)').slice(0, CHUNK)) },
    Tipo: { select: { name: typeOf(note) } },
    Destino: { rich_text: richText(note.dest || '') },
    Estado: status ? { select: { name: status } } : { select: null },
    'ID Senda': { number: note.id },
    Datos: { rich_text: richText(JSON.stringify(data)) }
  };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!requireAccess(req, res)) return;
  const auth = resolveAuth(req);
  if (!auth) return res.status(401).json({ error: 'Notion no está conectado' });
  const notion = new Client({ auth: auth.token });

  try {
    let dbId = await findInbox(notion, auth.token);

    if (req.method === 'GET') {
      if (!dbId) return res.status(200).json({ notes: [], settings: {}, databaseId: null });
      const notes: SyncedNote[] = [];
      let settings: Record<string, unknown> = {};
      let cursor: string | undefined;
      const limit = Math.min(Number(queryParam(req, 'limit')) || 200, 500);
      do {
        const r: any = await notion.databases.query({
          database_id: dbId,
          sorts: [{ property: 'ID Senda', direction: 'descending' }],
          page_size: 100,
          start_cursor: cursor
        });
        for (const row of r.results) {
          const id = row.properties['ID Senda']?.number;
          const raw = readRich(row.properties.Datos);
          if (id === SETTINGS_ID) {
            try { settings = JSON.parse(raw || '{}'); } catch { /* ajustes dañados: se ignoran */ }
            continue;
          }
          try {
            const note = JSON.parse(raw) as SyncedNote;
            // Lo editado directamente en Notion (título) tiene prioridad
            const title = readRich(row.properties.Mensaje);
            if (title && title !== '(vacío)' && !note.isAI) note.text = title;
            notes.push({ ...note, inboxId: row.id });
          } catch {
            // Fila creada a mano en Notion: se muestra como nota simple
            const title = readRich(row.properties.Mensaje);
            if (title) notes.push({ id: typeof id === 'number' ? id : Date.parse(row.created_time), text: title, time: 'Notion', topic: 'general', inboxId: row.id });
          }
        }
        cursor = r.has_more && notes.length < limit ? r.next_cursor : undefined;
      } while (cursor);
      return res.status(200).json({ notes, settings, databaseId: dbId });
    }

    // Escrituras: crear la bandeja si todavía no existe
    if (!dbId) {
      const parent = await parentPage(notion, req);
      if (!parent) return res.status(409).json({ error: 'Comparte una página con la conexión Senda para guardar el historial.' });
      dbId = await createInbox(notion, auth.token, parent);
    }

    if (req.method === 'POST') {
      const { note } = (req.body || {}) as { note?: SyncedNote };
      if (!note || typeof note.id !== 'number' || note.id === SETTINGS_ID) return res.status(400).json({ error: 'Nota inválida.' });
      const properties = propsFor(note) as any;
      let pageId = note.inboxId || (await rowFor(notion, dbId, note.id));
      if (pageId) {
        try {
          await notion.pages.update({ page_id: pageId, properties });
        } catch {
          pageId = null; // la fila se borró en Notion: se vuelve a crear
        }
      }
      if (!pageId) {
        const page: any = await notion.pages.create({ parent: { database_id: dbId }, properties });
        pageId = page.id;
      }
      return res.status(200).json({ inboxId: pageId });
    }

    if (req.method === 'PUT') {
      const { settings } = (req.body || {}) as { settings?: Record<string, unknown> };
      if (!settings || typeof settings !== 'object') return res.status(400).json({ error: 'Ajustes inválidos.' });
      const properties = {
        Mensaje: { title: richText('⚙︎ Ajustes de Senda') },
        Tipo: { select: { name: 'Ajustes' } },
        'ID Senda': { number: SETTINGS_ID },
        Datos: { rich_text: richText(JSON.stringify(settings)) }
      } as any;
      const pageId = await rowFor(notion, dbId, SETTINGS_ID);
      if (pageId) await notion.pages.update({ page_id: pageId, properties });
      else await notion.pages.create({ parent: { database_id: dbId }, properties });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = Number(queryParam(req, 'id'));
      if (!Number.isFinite(id) || id === SETTINGS_ID) return res.status(400).json({ error: 'id inválido.' });
      const pageId = queryParam(req, 'inboxId') || (await rowFor(notion, dbId, id));
      if (pageId) await notion.pages.update({ page_id: pageId, archived: true }).catch(() => undefined);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    return res.status(500).json({ error: errorMessage(err) });
  }
}
