import { Client } from '@notionhq/client';
import { errorMessage, header, type ApiRequest, type ApiResponse } from './_lib/http.js';
import { readSession } from './_lib/session.js';

type Source = 'token' | 'oauth' | 'env';

/** UUID de Notion, con o sin guiones. */
const BLOCK_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/**
 * Prioridad de credenciales:
 *   1. x-notion-token  (token interno pegado en Personalizar)
 *   2. cookie OAuth    (Conectar con Notion)
 *   3. NOTION_TOKEN    (variable de entorno del despliegue)
 */
function resolveAuth(req: ApiRequest) {
  const manual = header(req, 'x-notion-token');
  if (manual) return { token: manual, source: 'token' as Source, session: null };
  const session = readSession(req);
  if (session) return { token: session.accessToken, source: 'oauth' as Source, session };
  if (process.env.NOTION_TOKEN) return { token: process.env.NOTION_TOKEN, source: 'env' as Source, session: null };
  return null;
}

/** En un workspace personal hay una sola persona: es el usuario. Requiere el permiso "Read user information". */
async function soleWorkspacePerson(notion: Client) {
  try {
    const list: any = await notion.users.list({ page_size: 20 });
    const people = list.results.filter((u: any) => u.type === 'person');
    return people.length === 1 ? (people[0] as { name?: string | null; avatar_url?: string | null }) : undefined;
  } catch {
    return undefined;
  }
}

function plainTitle(prop: any): string {
  return (prop?.title || []).map((t: any) => t.plain_text).join('').trim();
}

function plainText(prop: any): string {
  return (prop?.rich_text || []).map((t: any) => t.plain_text).join('').trim();
}

/** Columnas de texto que sirven para reconocer una fila (p. ej. "Palabras clave", "Código"). */
const KEYWORD_PROP = /palabra|clave|keyword|alias|c[oó]digo|code|sigla/i;

/** Filas de una base relacionada (p. ej. Obras) con sus palabras clave, para enlazar por texto. */
async function relationTargets(notion: Client, databaseId: string) {
  const rows: { id: string; title: string; keywords: string[] }[] = [];
  let cursor: string | undefined;
  do {
    const r: any = await notion.databases.query({ database_id: databaseId, page_size: 100, start_cursor: cursor });
    for (const page of r.results) {
      const props = Object.entries(page.properties || {}) as [string, any][];
      const title = plainTitle(props.find(([, p]) => p.type === 'title')?.[1]);
      if (!title) continue;
      const keywords = props
        .filter(([name, p]) => p.type === 'rich_text' && KEYWORD_PROP.test(name))
        .flatMap(([, p]) => plainText(p).split(/[,;\n]/))
        .map((k) => k.trim())
        .filter(Boolean);
      rows.push({ id: page.id, title, keywords });
    }
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor && rows.length < 300);
  return rows;
}

/** Bases compartidas con la integración y su esquema (lo que Senda puede completar). */
async function listDatabases(notion: Client) {
  const search: any = await notion.search({
    filter: { property: 'object', value: 'database' } as any,
    sort: { direction: 'descending', timestamp: 'last_edited_time' },
    page_size: 15
  });
  const targetsCache = new Map<string, Promise<{ id: string; title: string; keywords: string[] }[]>>();

  return Promise.all(
    search.results.map(async (db: any) => {
      const entries = Object.entries(db.properties || {}) as [string, any][];
      const properties = await Promise.all(
        entries.map(async ([name, p]) => {
          const base: { name: string; type: string; options?: string[]; targets?: unknown[] } = { name, type: p.type };
          if (p.type === 'select' || p.type === 'multi_select' || p.type === 'status') {
            base.options = (p[p.type]?.options || []).map((o: any) => o.name);
          }
          if (p.type === 'relation' && p.relation?.database_id) {
            const target = p.relation.database_id as string;
            if (!targetsCache.has(target)) targetsCache.set(target, relationTargets(notion, target).catch(() => []));
            base.targets = await targetsCache.get(target)!;
          }
          return base;
        })
      );
      return {
        id: db.id as string,
        title: (db.title || []).map((t: any) => t.plain_text).join('').trim() || 'Base sin título',
        properties
      };
    })
  );
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = resolveAuth(req);
  if (!auth) return res.status(401).json({ error: 'Notion no está conectado' });

  const notion = new Client({ auth: auth.token });
  const defaultPageId = header(req, 'x-notion-page-id') || process.env.NOTION_DEFAULT_PAGE_ID || '';

  // GET: usuario conectado + páginas compartidas con la integración
  if (req.method === 'GET') {
    try {
      const me: any = await notion.users.me({});
      const search = await notion.search({
        filter: { property: 'object', value: 'page' },
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
        page_size: 25
      });

      // Las filas de bases (p. ej. cada tarea) también son páginas: se excluyen de la lista
      const pages = search.results.filter((p: any) => p.parent?.type !== 'database_id').map((p: any) => {
        const titleProp = Object.values(p.properties || {}).find((prop: any) => prop.type === 'title') as any;
        const title = titleProp?.title?.map((t: any) => t.plain_text).join('') || 'Sin título';
        return { id: p.id as string, title };
      });

      // users.me devuelve el BOT (p. ej. "Senda"), no a la persona. Orden para el nombre real:
      // NOTION_USER_NAME → dueño OAuth → dueño del bot → única persona del workspace.
      let person: { name?: string | null; avatar_url?: string | null } | undefined =
        auth.session?.userName ? { name: auth.session.userName, avatar_url: auth.session.userAvatar } : me?.bot?.owner?.user;
      if (!person?.name) person = await soleWorkspacePerson(notion);

      const name = process.env.NOTION_USER_NAME || person?.name || me?.bot?.workspace_name || me?.name || 'Usuario Notion';
      const avatar = person?.avatar_url || null;

      const databases = await listDatabases(notion).catch(() => []);

      return res.status(200).json({
        source: auth.source,
        databases,
        user: { name, avatar },
        workspace: auth.session?.workspaceName || me?.bot?.workspace_name || null,
        pages
      });
    } catch (err) {
      return res.status(500).json({ error: errorMessage(err) });
    }
  }

  // POST: crear una fila en una base ({ databaseId, properties }) o añadir bloques a una página
  if (req.method === 'POST') {
    try {
      const { targetPageId, blocks, databaseId, properties } = (req.body || {}) as {
        targetPageId?: string;
        blocks?: unknown[];
        databaseId?: string;
        properties?: Record<string, unknown>;
      };

      if (databaseId) {
        if (!BLOCK_ID.test(databaseId) || !properties || typeof properties !== 'object') {
          return res.status(400).json({ error: 'databaseId o properties inválidos.' });
        }
        const page: any = await notion.pages.create({
          parent: { database_id: databaseId },
          properties: properties as any,
          ...(Array.isArray(blocks) && blocks.length ? { children: blocks.slice(0, 100) as any } : {})
        });
        return res.status(200).json({ ok: true, results: [{ id: page.id, url: page.url }] });
      }

      const destination = targetPageId || defaultPageId;

      if (!destination) return res.status(400).json({ error: 'No se especificó página destino en Notion.' });
      if (!Array.isArray(blocks) || blocks.length === 0) return res.status(400).json({ error: 'No hay bloques para enviar.' });
      if (blocks.length > 100) return res.status(400).json({ error: 'Notion acepta como máximo 100 bloques por envío.' });

      const response = await notion.blocks.children.append({
        block_id: destination,
        children: blocks as any
      });

      return res.status(200).json({ ok: true, results: response.results });
    } catch (err) {
      return res.status(500).json({ error: errorMessage(err) });
    }
  }

  // PATCH: marcar / desmarcar una tarea
  if (req.method === 'PATCH') {
    try {
      const { blockId, checked, property } = (req.body || {}) as { blockId?: string; checked?: boolean; property?: string };
      if (!blockId || !BLOCK_ID.test(blockId)) return res.status(400).json({ error: 'blockId inválido.' });
      if (property) {
        // Fila de una base: la casilla es una propiedad (p. ej. "Hecho")
        await notion.pages.update({ page_id: blockId, properties: { [property]: { checkbox: !!checked } } as any });
      } else {
        await notion.blocks.update({ block_id: blockId, to_do: { checked: !!checked } } as any);
      }
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: errorMessage(err) });
    }
  }

  // DELETE ?ids=a,b: mandar bloques a la papelera de Notion
  if (req.method === 'DELETE') {
    const ids = String(req.query?.ids || '').split(',').filter(Boolean);
    if (ids.length === 0 || ids.length > 100 || !ids.every((id) => BLOCK_ID.test(id))) {
      return res.status(400).json({ error: 'ids inválidos.' });
    }
    const failed: string[] = [];
    for (const id of ids) {
      try {
        await notion.blocks.delete({ block_id: id });
      } catch (err: any) {
        // Ya borrado en Notion → para Senda cuenta como éxito
        if (err?.code !== 'object_not_found' && !/archived/i.test(err?.message || '')) failed.push(id);
      }
    }
    if (failed.length) return res.status(500).json({ error: 'No se pudieron borrar algunos bloques.', failed });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Método no permitido' });
}
