import { appOrigin, type ApiRequest, type ApiResponse } from './_lib/http.js';
import { issueState } from './_lib/session.js';

/**
 * GET /api/oauth-login → redirige a la pantalla de autorización de Notion.
 * Requiere una integración PÚBLICA en notion.so/my-integrations.
 */
export default function handler(req: ApiRequest, res: ApiResponse) {
  const clientId = process.env.NOTION_OAUTH_CLIENT_ID;
  if (!clientId || !process.env.NOTION_OAUTH_CLIENT_SECRET || !process.env.SESSION_SECRET) {
    return res.redirect(302, '/?notion=error&reason=' + encodeURIComponent('OAuth no configurado en el servidor'));
  }

  const redirectUri = `${appOrigin(req)}/api/oauth-callback`;
  const url = new URL('https://api.notion.com/v1/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('owner', 'user');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', issueState(res));

  return res.redirect(302, url.toString());
}
