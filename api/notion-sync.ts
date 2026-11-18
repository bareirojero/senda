import { Client } from '@notionhq/client';

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const notionToken = req.headers['x-notion-token'] || process.env.NOTION_TOKEN;
  const defaultPageId = req.headers['x-notion-page-id'] || process.env.NOTION_DEFAULT_PAGE_ID;

  if (!notionToken) {
    return res.status(401).json({ error: 'Falta configurar NOTION_TOKEN' });
  }

  const notion = new Client({ auth: notionToken });

  // GET: Obtener usuario real conectado en Notion y sus páginas raíz
  if (req.method === 'GET') {
    try {
      const me = await notion.users.me({});
      const search = await notion.search({
        filter: { property: 'object', value: 'page' },
        page_size: 12
      });

      const pages = search.results.map((p: any) => {
        const titleProp = Object.values(p.properties || {}).find((prop: any) => prop.type === 'title') as any;
        const title = titleProp?.title?.[0]?.plain_text || 'Sin título';
        return { id: p.id, title };
      });

      return res.status(200).json({
        user: {
          name: me.name || 'Usuario Notion',
          avatar: me.avatar_url || null
        },
        pages
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST: Escribir bloques formateados en Notion
  if (req.method === 'POST') {
    try {
      const { targetPageId, blocks } = req.body;
      const destination = targetPageId || defaultPageId;

      if (!destination) {
        return res.status(400).json({ error: 'No se especificó página destino en Notion.' });
      }

      const response = await notion.blocks.children.append({
        block_id: destination,
        children: blocks
      });

      return res.status(200).json({ ok: true, results: response.results });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Método no permitido' });
}
