import { Client } from '@notionhq/client';
import { errorMessage, header, type ApiRequest, type ApiResponse } from './_lib/http.js';
import { readSession } from './_lib/session.js';

type Source = 'token' | 'oauth' | 'env';

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

      const pages = search.results.map((p: any) => {
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

      return res.status(200).json({
        source: auth.source,
        user: { name, avatar },
        workspace: auth.session?.workspaceName || me?.bot?.workspace_name || null,
        pages
      });
    } catch (err) {
      return res.status(500).json({ error: errorMessage(err) });
    }
  }

  // POST: añadir bloques formateados a la página destino
  if (req.method === 'POST') {
    try {
      const { targetPageId, blocks } = (req.body || {}) as { targetPageId?: string; blocks?: unknown[] };
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

  return res.status(405).json({ error: 'Método no permitido' });
}
