import type { ApiRequest, ApiResponse } from './_lib/http.js';
import { clearSession } from './_lib/session.js';

/** POST /api/oauth-logout → borra la cookie de sesión de Notion. */
export default function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  clearSession(res);
  return res.status(200).json({ ok: true });
}
